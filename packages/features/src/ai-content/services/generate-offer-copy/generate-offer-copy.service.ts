import {
  chatCompletion,
  initAIClient,
  isAIClientInitialized,
} from '@borradh-workspace/ai';
import { offer, offerService } from '@borradh-workspace/database';
import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, eq, inArray } from 'drizzle-orm';
import { validateGeneratedCopy } from '../../../assistant/services/generate-recommendation-payload/d2b-validator.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { getOrgContext } from '../../../shared/org-context.js';
import {
  type GenerateOfferCopyInput,
  type GeneratedOfferCopy,
  generateOfferCopySchema,
  generatedOfferCopySchema,
} from './generate-offer-copy.schema.js';
import {
  OFFER_COPY_SYSTEM_PROMPT,
  buildOfferCopyUserPrompt,
} from './prompts.js';
import { getOfferCopyFallback } from './static-fallback.js';

const logger = createLogger('GenerateOfferCopy');

const MAX_ATTEMPTS = 3;
const AI_MAX_TOKENS = 500;

/**
 * Generate video-copy bundle for an offer.
 *
 * Window 9 introduces this service to back the video-creation flow after
 * the old offer.headline / ctaText / urgencyText / audienceText / bulletPoints
 * columns were dropped (Window 1). Called from `POST
 * /ai-content/generate-offer-copy` whenever the user picks an offer in the
 * create-video flow. Returns benefit-focused copy that complies with the
 * shared d2b validator (no percentages, outcome claims, banned phrases, or
 * POM brand names).
 *
 * Failure modes — always returns ok() with safe fallback copy:
 *   - OPENAI_API_KEY not configured → templated fallback
 *   - LLM error / invalid JSON / d2b rejection (after retries) → fallback
 *   - Offer not found → err(NOT_FOUND); offer must belong to org
 */
const generateOfferCopyImpl = async (
  db: DbConnection,
  input: GenerateOfferCopyInput,
  apiKey?: string
): Promise<Result<GeneratedOfferCopy>> => {
  const parsed = generateOfferCopySchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, offerId, refinementInstruction, priorCopy } =
    parsed.data;

  // Fetch the offer (must belong to the caller's org).
  const offerRow = await db.query.offer.findFirst({
    where: and(
      eq(offer.id, offerId),
      eq(offer.organizationId, organizationId),
      notDeleted(offer)
    ),
    with: {
      offerServices: true,
    },
  });

  if (!offerRow) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Offer not found', { offerId })
    );
  }

  // Resolve service names for prompt context.
  const linkedServiceIds = offerRow.offerServices.map((os) => os.serviceId);
  const orgContext = await getOrgContext(db, organizationId);
  const linkedServiceNames =
    linkedServiceIds.length === 0 || !orgContext
      ? []
      : await readServiceNames(db, organizationId, linkedServiceIds);

  // Resolve org name (separate query — getOrgContext doesn't expose it).
  const orgName = await readOrganizationName(db, organizationId);
  const businessType = orgContext?.businessType ?? null;

  const userPrompt = buildOfferCopyUserPrompt({
    organizationName: orgName,
    businessType,
    offer: offerRow,
    serviceNames: linkedServiceNames,
    refinementInstruction,
    priorCopy,
  });

  // Initialise AI client; bail to fallback if no key.
  if (!isAIClientInitialized()) {
    if (!apiKey) {
      logger.warn('OPENAI_API_KEY not configured; using fallback copy', {
        organizationId,
        offerId,
      });
      return ok(getOfferCopyFallback(offerRow, linkedServiceNames[0]));
    }
    initAIClient({ apiKey });
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await chatCompletion(userPrompt, {
        maxTokens: AI_MAX_TOKENS,
        systemMessage: OFFER_COPY_SYSTEM_PROMPT,
        jsonResponse: true,
        temperature: 0.7,
      });

      if (!response.content) {
        logger.warn('LLM returned empty content', {
          organizationId,
          offerId,
          attempt,
        });
        continue;
      }

      let raw: unknown;
      try {
        raw = JSON.parse(response.content);
      } catch {
        logger.warn('LLM returned invalid JSON', {
          organizationId,
          offerId,
          attempt,
        });
        continue;
      }

      const schemaCheck = generatedOfferCopySchema.safeParse(raw);
      if (!schemaCheck.success) {
        logger.warn('LLM output failed schema check', {
          organizationId,
          offerId,
          attempt,
        });
        continue;
      }

      // d2b validator runs over the flat string fields. bulletPoints
      // need to be checked per-item, so flatten before validating.
      const flat = {
        headline: schemaCheck.data.headline,
        ctaText: schemaCheck.data.ctaText,
        urgencyText: schemaCheck.data.urgencyText,
        audienceText: schemaCheck.data.audienceText,
        ...Object.fromEntries(
          schemaCheck.data.bulletPoints.map((b, i) => [`bullet_${i}`, b])
        ),
      };
      const failures = validateGeneratedCopy(flat);
      if (failures.length > 0) {
        logger.warn('LLM output failed d2b validator', {
          organizationId,
          offerId,
          attempt,
          failures,
        });
        continue;
      }

      return ok(schemaCheck.data);
    } catch (llmError) {
      logger.warn('LLM call threw; retrying or falling back', {
        organizationId,
        offerId,
        attempt,
        error: llmError instanceof Error ? llmError.message : String(llmError),
      });
    }
  }

  logError(
    'aiContent.generateOfferCopy',
    new Error(
      'LLM generation failed after max attempts; using fallback offer copy'
    ),
    { feature: 'ai-content', extra: { organizationId, offerId } }
  );
  return ok(getOfferCopyFallback(offerRow, linkedServiceNames[0]));
};

async function readOrganizationName(
  db: DbConnection,
  organizationId: string
): Promise<string | null> {
  // Lazy import to keep this file leaf-friendly for tests that mock the
  // database module.
  const { organization } = await import('@borradh-workspace/database');
  const [row] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(and(eq(organization.id, organizationId), notDeleted(organization)))
    .limit(1);
  return row?.name ?? null;
}

async function readServiceNames(
  db: DbConnection,
  organizationId: string,
  serviceIds: string[]
): Promise<string[]> {
  if (serviceIds.length === 0) return [];
  const { organizationService } = await import('@borradh-workspace/database');
  const rows = await db
    .select({ name: organizationService.name })
    .from(organizationService)
    .where(
      and(
        eq(organizationService.organizationId, organizationId),
        inArray(organizationService.id, serviceIds)
      )
    );
  return rows.map((r) => r.name);
}

// `offerService` is imported above so the test mocks have a value to bind
// against (mirrors the pattern in `update-offer.service`). Re-emit the
// reference so dead-code elimination doesn't drop it from the bundle.
void offerService;

export const generateOfferCopy = (
  db: DbConnection,
  input: GenerateOfferCopyInput,
  apiKey?: string
) =>
  trackedResult(
    'aiContent.generateOfferCopy',
    () => generateOfferCopyImpl(db, input, apiKey),
    {
      properties: {
        organizationId: input.organizationId,
        offerId: input.offerId,
      },
    }
  );

export type GenerateOfferCopyResult = Awaited<
  ReturnType<typeof generateOfferCopy>
>;
