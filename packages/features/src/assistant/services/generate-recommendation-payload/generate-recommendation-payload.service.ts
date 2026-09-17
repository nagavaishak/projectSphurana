import {
  chatCompletion,
  initAIClient,
  isAIClientInitialized,
} from '@borradh-workspace/ai';
import { organization, organizationService } from '@borradh-workspace/database';
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
import { validateGeneratedCopy } from './d2b-validator.js';
import {
  type GenerateRecommendationPayloadInput,
  type GeneratedPayload,
  generateRecommendationPayloadSchema,
  generatedPayloadSchema,
} from './generate-recommendation-payload.schema.js';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompts.js';
import { getStaticFallback } from './static-fallbacks.js';

const logger = createLogger('GenerateRecommendationPayload');

const MAX_ATTEMPTS = 3;
const AI_MAX_TOKENS = 500;

/**
 * Generates the title/body/payload for a recommendation using the LLM and
 * the clinic's context. On ANY failure (no API key, network error, malformed
 * JSON, D2b validator reject after retries), falls back to static copy so
 * the trigger always ships a safe recommendation.
 *
 * See docs/plans/claire-spec-v2.md Decision 2b.
 */
const generateRecommendationPayloadImpl = async (
  db: DbConnection,
  input: GenerateRecommendationPayloadInput
): Promise<Result<GeneratedPayload>> => {
  const parsed = generateRecommendationPayloadSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, kind, triggerContext } = parsed.data;

  // Fetch clinic context.
  let clinicName: string | undefined;
  let services: Array<{ name: string }> | undefined;

  try {
    const [org] = await db
      .select({ name: organization.name })
      .from(organization)
      .where(and(eq(organization.id, organizationId), notDeleted(organization)))
      .limit(1);
    clinicName = org?.name;

    const serviceRows = await db
      .select({ name: organizationService.name })
      .from(organizationService)
      .where(eq(organizationService.organizationId, organizationId))
      .limit(30);
    services = serviceRows;
  } catch (ctxError) {
    // Can't load context — fall back to static. Not a hard error.
    logger.warn('Failed to load org context; using static fallback', {
      organizationId,
      error: ctxError instanceof Error ? ctxError.message : String(ctxError),
    });
    return ok(getStaticFallback(kind));
  }

  // Initialise AI client if needed.
  if (!isAIClientInitialized()) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      logger.warn('OPENAI_API_KEY not set; using static fallback', {
        organizationId,
        kind,
      });
      return ok(getStaticFallback(kind));
    }
    initAIClient({ apiKey });
  }

  const userPrompt = buildUserPrompt(kind, {
    clinicName,
    services,
    hasAnyCampaign: false, // `prompt_create_first_ad` fires only when no campaign exists
    triggerContext,
  });

  // Retry up to MAX_ATTEMPTS on JSON parse fail or D2b reject.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await chatCompletion(userPrompt, {
        maxTokens: AI_MAX_TOKENS,
        systemMessage: SYSTEM_PROMPT,
        jsonResponse: true,
        temperature: 0.7,
      });

      if (!response.content) {
        logger.warn('LLM returned empty content', {
          organizationId,
          kind,
          attempt,
        });
        continue;
      }

      let rawPayload: unknown;
      try {
        rawPayload = JSON.parse(response.content);
      } catch {
        logger.warn('LLM returned invalid JSON', {
          organizationId,
          kind,
          attempt,
        });
        continue;
      }

      const schemaCheck = generatedPayloadSchema.safeParse(rawPayload);
      if (!schemaCheck.success) {
        logger.warn('LLM output failed schema check', {
          organizationId,
          kind,
          attempt,
        });
        continue;
      }

      const failures = validateGeneratedCopy(schemaCheck.data);
      if (failures.length > 0) {
        logger.warn('LLM output failed D2b validator', {
          organizationId,
          kind,
          attempt,
          failures,
        });
        continue;
      }

      return ok(schemaCheck.data);
    } catch (llmError) {
      logger.warn('LLM call threw; retrying or falling back', {
        organizationId,
        kind,
        attempt,
        error: llmError instanceof Error ? llmError.message : String(llmError),
      });
    }
  }

  // All retries failed — return static fallback without paging Sentry. The user
  // still gets deterministic content, so this is degraded service telemetry.
  logger.warn(
    'LLM generation failed after max attempts; using static fallback',
    {
      organizationId,
      kind,
    }
  );
  return ok(getStaticFallback(kind));
};

export const generateRecommendationPayload = (
  db: DbConnection,
  input: GenerateRecommendationPayloadInput
) =>
  trackedResult(
    'assistant.generateRecommendationPayload',
    () => generateRecommendationPayloadImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        kind: input.kind,
      },
    }
  );
