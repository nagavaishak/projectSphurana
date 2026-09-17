import { initAIClient, isAIClientInitialized } from '@borradh-workspace/ai';
import { trackedResult } from '@borradh-workspace/observability';
import { generateOfferCopy } from '../../../ai-content/index.js';
import { getOffer } from '../../../offers/index.js';
import { getOrganizationBrand } from '../../../organizations/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type BuildOfferCardInput,
  buildOfferCardSchema,
} from './build-offer-card.schema.js';
import {
  type OfferCardBlock,
  buildOfferCardBlock,
} from './offer-card-block.js';

/** Re-wrap a tracked (structural) error into a `FeatureError` for propagation. */
const rewrap = (error: {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}): FeatureError => new FeatureError(error.code, error.message, error.details);

/**
 * Initialise the shared AI client if a key is configured. Best-effort: when no
 * key is present `generateOfferCopy` falls back to safe templated copy, so a
 * missing key is not fatal here.
 */
const ensureAIClient = async (): Promise<void> => {
  if (isAIClientInitialized()) return;
  const { apiEnv } = await import('@borradh-workspace/env/api');
  const apiKey = apiEnv.OPENAI_API_KEY;
  if (apiKey) initAIClient({ apiKey });
};

/**
 * Assemble a renderable `offerCard` draft-config block for an offer video.
 *
 * Combines three sources, mirroring the legacy wizard's offer-card assembly so
 * the one-prompt path (Claire) and the wizard render identically:
 *   1. Pricing — read straight from the offer row.
 *   2. Copy — `generateOfferCopy` (benefit-focused, d2b-validated; safe
 *      templated fallback when the LLM/API key is unavailable).
 *   3. Branding — the org's resolved brand colours + logo.
 *
 * The offer must belong to the org; otherwise NOT_FOUND. The returned block is
 * spread onto the draft config by the controller (orientation/captions are set
 * there, matching the organic path).
 */
const buildOfferCardImpl = async (
  db: DbConnection,
  input: BuildOfferCardInput
): Promise<Result<OfferCardBlock>> => {
  const parsed = buildOfferCardSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, offerId, serviceName, businessName } = parsed.data;

  // Offer must exist + belong to the org. Pricing comes from this row.
  // (`getOffer`/`generateOfferCopy` are `trackedResult`-wrapped, so their
  // error is the structural `{ code, message, details }` shape — re-wrap into
  // a `FeatureError` before propagating.)
  const offerResult = await getOffer(db, { id: offerId, organizationId });
  if (!offerResult.success) {
    return err(rewrap(offerResult.error));
  }
  const { offer } = offerResult.data;

  await ensureAIClient();

  // Copy generation always resolves to ok() (templated fallback on failure),
  // except when the offer can't be loaded — which we already handled above.
  const copyResult = await generateOfferCopy(db, { organizationId, offerId });
  if (!copyResult.success) {
    return err(rewrap(copyResult.error));
  }

  // Branding is best-effort — a card still renders with default colours.
  const brandResult = await getOrganizationBrand(db, { organizationId });
  const brand = brandResult.success
    ? {
        primaryColor: brandResult.data.primaryColor,
        secondaryColor: brandResult.data.secondaryColor,
        logoUrl: brandResult.data.logoUrl,
      }
    : null;

  return ok(
    buildOfferCardBlock({
      copy: copyResult.data,
      pricing: {
        originalPriceCents: offer.originalPriceCents,
        offerPriceCents: offer.offerPriceCents,
        // Deliberately omit discountPercent: the brand never shows a "% off"
        // badge — the offer card renders the price drop as Was/Now from the
        // two prices above. Passing a percent would light up the % badge in
        // offer-card-layer.tsx on top of the Was/Now prices.
        discountPercent: null,
      },
      serviceName,
      brand,
      businessName,
    })
  );
};

export const buildOfferCard = (db: DbConnection, input: BuildOfferCardInput) =>
  trackedResult('videos.buildOfferCard', () => buildOfferCardImpl(db, input), {
    properties: {
      organizationId: input.organizationId,
      offerId: input.offerId,
    },
    internalErrorsOnly: true,
  });

export type BuildOfferCardResult = Awaited<ReturnType<typeof buildOfferCard>>;
