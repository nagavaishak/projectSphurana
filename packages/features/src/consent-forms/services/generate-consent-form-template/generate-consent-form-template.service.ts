import {
  chatCompletion,
  initAIClient,
  isAIClientInitialized,
} from '@borradh-workspace/ai';
import { organization } from '@borradh-workspace/database';
import { createLogger, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type GenerateConsentFormTemplateInput,
  type GeneratedConsentFormTemplate,
  generateConsentFormTemplateSchema,
  generatedConsentFormTemplateSchema,
} from './generate-consent-form-template.schema.js';
import {
  CONSENT_FORM_SYSTEM_PROMPT,
  buildConsentFormUserPrompt,
} from './prompts.js';

const logger = createLogger('GenerateConsentFormTemplate');

const MAX_ATTEMPTS = 3;
const AI_MODEL = 'gpt-5.6-luna';
const AI_MAX_TOKENS = 1500;

/**
 * "Write with AI" for consent-form templates (ENG-647). Turns a short clinic
 * description into a full template draft — title, patient-facing body (with the
 * {{patientName}} placeholder), extra fields, and the signature flag — which
 * the dialog drops into the create form for the clinician to review and edit.
 *
 * Never persists anything; it only drafts. Failure modes:
 *   - OPENAI_API_KEY not configured → EXTERNAL_SERVICE_ERROR (controller 502).
 *   - LLM error / invalid JSON / schema miss after retries → EXTERNAL_SERVICE_ERROR.
 */
const generateConsentFormTemplateImpl = async (
  db: DbConnection,
  input: GenerateConsentFormTemplateInput,
  apiKey?: string
): Promise<Result<GeneratedConsentFormTemplate>> => {
  const parsed = generateConsentFormTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, prompt } = parsed.data;

  // Light context so the tone matches the clinic. Best-effort — a missing org
  // name just drops that line from the prompt.
  const orgRow = await db.query.organization.findFirst({
    where: and(eq(organization.id, organizationId), notDeleted(organization)),
    columns: { name: true },
  });

  const userPrompt = buildConsentFormUserPrompt({
    organizationName: orgRow?.name ?? null,
    description: prompt,
  });

  // Initialise the AI client; without a key there is nothing to call.
  if (!isAIClientInitialized()) {
    if (!apiKey) {
      return err(
        new FeatureError(
          ErrorCodes.EXTERNAL_SERVICE_ERROR,
          'AI drafting is not configured'
        )
      );
    }
    initAIClient({ apiKey, defaultModel: AI_MODEL });
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await chatCompletion(userPrompt, {
        model: AI_MODEL,
        maxTokens: AI_MAX_TOKENS,
        systemMessage: CONSENT_FORM_SYSTEM_PROMPT,
        jsonResponse: true,
        temperature: 0.5,
      });

      if (!response.content) {
        logger.warn('LLM returned empty content', { organizationId, attempt });
        continue;
      }

      let raw: unknown;
      try {
        raw = JSON.parse(response.content);
      } catch {
        logger.warn('LLM returned invalid JSON', { organizationId, attempt });
        continue;
      }

      const schemaCheck = generatedConsentFormTemplateSchema.safeParse(raw);
      if (!schemaCheck.success) {
        logger.warn('LLM output failed schema check', {
          organizationId,
          attempt,
        });
        continue;
      }

      return ok(schemaCheck.data);
    } catch (llmError) {
      logger.warn('LLM call threw; retrying', {
        organizationId,
        attempt,
        error: llmError instanceof Error ? llmError.message : String(llmError),
      });
    }
  }

  return err(
    new FeatureError(
      ErrorCodes.EXTERNAL_SERVICE_ERROR,
      'AI could not draft the form. Please try again.'
    )
  );
};

export const generateConsentFormTemplate = (
  db: DbConnection,
  input: GenerateConsentFormTemplateInput,
  apiKey?: string
) =>
  trackedResult(
    'consentForms.generateConsentFormTemplate',
    () => generateConsentFormTemplateImpl(db, input, apiKey),
    { properties: { organizationId: input.organizationId } }
  );

export type GenerateConsentFormTemplateResult = Awaited<
  ReturnType<typeof generateConsentFormTemplate>
>;
