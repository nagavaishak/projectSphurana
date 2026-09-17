import {
  type Offer,
  offer,
  offerService,
  organizationService,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { listServicesForOrg } from '../../organization-services/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../shared/index.js';
import { getCurrentCycle, setDraftPointer } from '../push-memory/index.js';
import { recomputeRanking } from '../recommendation-engine/index.js';
import { getBusinessProfile } from '../services/get-business-profile/index.js';
import {
  buildDefaultOfferName,
  buildDefaultOfferPricing,
  buildDefaultValidity,
  pickDefaultRankedService,
} from './draft-defaults.js';
import {
  type GetOrCreateDraftOfferInput,
  getOrCreateDraftOfferSchema,
} from './draft-offer.schema.js';

export interface DraftOfferWithLinks {
  offer: Offer;
  serviceIds: string[];
  locationIds: string[];
}

/**
 * Get the chat-owned draft offer for this conversation, creating one
 * pre-populated from the top-ranked service if it doesn't exist yet.
 *
 * Pricing policy: the draft is ALWAYS `fixed_price` with both an intro
 * ("now") price and a "was" anchor (`originalPriceCents`) so the
 * "Was €X → now €X" / "Just €X" framing can render. We never default to a
 * `percentage` discount ("30% off feels cheap"). Prices are derived from the
 * ranked service's `suggestedIntroPrice` / `ownerEstimatedCompetitorPrice`,
 * falling back to a concrete intro price the owner overrides on first
 * interaction. See `buildDefaultOfferPricing`. Fully populated per Decision
 * #15.
 *
 * Validity: 30-day window starting today.
 */
const getOrCreateDraftOfferImpl = async (
  db: DbConnection,
  input: GetOrCreateDraftOfferInput
): Promise<Result<DraftOfferWithLinks>> => {
  const parsed = getOrCreateDraftOfferSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, conversationId, serviceId } = parsed.data;

  const cycle = await getCurrentCycle(db, {
    organizationId,
    conversationId,
    kind: 'ad_flow_offer_pick',
  });
  if (!cycle.success) {
    return err(new FeatureError(cycle.error.code, cycle.error.message));
  }

  const cycleDraftId = (cycle.data?.metadata as { draftId?: string } | null)
    ?.draftId;
  if (cycleDraftId) {
    const existing = await db.query.offer.findFirst({
      where: and(
        eq(offer.id, cycleDraftId),
        eq(offer.organizationId, organizationId),
        notDeleted(offer)
      ),
    });
    if (existing && existing.state === 'draft') {
      const services = await db
        .select({ serviceId: offerService.serviceId })
        .from(offerService)
        .where(eq(offerService.offerId, existing.id));
      return ok({
        offer: existing,
        serviceIds: services.map((s) => s.serviceId),
        locationIds: [], // empty = all org locations
      });
    }
  }

  const profile = await getBusinessProfile(db, { organizationId });
  if (!profile.success) {
    return err(
      new FeatureError(
        profile.error.code,
        'No business profile yet — Claire is still classifying this business.'
      )
    );
  }

  const servicesResult = await listServicesForOrg(db, { organizationId });
  if (!servicesResult.success) {
    return err(
      new FeatureError(servicesResult.error.code, servicesResult.error.message)
    );
  }
  const liveRanked = recomputeRanking(profile.data, servicesResult.data);
  const ranked = pickDefaultRankedService(liveRanked, serviceId);
  if (!ranked) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'No ranked services available. Add services first or wait for classification.'
      )
    );
  }

  const service = await db.query.organizationService.findFirst({
    where: and(
      eq(organizationService.id, ranked.serviceId),
      eq(organizationService.organizationId, organizationId)
    ),
  });
  if (!service) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'Ranked service no longer exists in the org menu.'
      )
    );
  }

  const { validFrom, validUntil } = buildDefaultValidity();

  // Per the discount-format spec ("Was €X → now €X" / "Just €X", never
  // "% off"), every default draft is a fixed-price intro with a populated
  // "was" anchor (`originalPriceCents`). We never default to a percentage —
  // the owner re-shapes the concrete price on first interaction.
  const defaultDiscount = buildDefaultOfferPricing(ranked);

  const [draft] = await db
    .insert(offer)
    .values({
      organizationId,
      name: buildDefaultOfferName({ serviceName: service.name }),
      code: null,
      state: 'draft',
      validFrom,
      validUntil,
      discountType: defaultDiscount.discountType,
      discountPercent: defaultDiscount.discountPercent,
      offerPriceCents: defaultDiscount.offerPriceCents,
      originalPriceCents: defaultDiscount.originalPriceCents,
      buyQuantity: defaultDiscount.buyQuantity,
      getQuantity: defaultDiscount.getQuantity,
      limitPerClient: false,
      redemptionLimit: null,
    })
    .returning();
  if (!draft) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to insert draft offer'
      )
    );
  }

  await db.insert(offerService).values({
    offerId: draft.id,
    serviceId: ranked.serviceId,
  });

  const pointer = await setDraftPointer(db, {
    organizationId,
    conversationId,
    kind: 'ad_flow_offer_pick',
    draftId: draft.id,
  });
  if (!pointer.success) {
    return err(new FeatureError(pointer.error.code, pointer.error.message));
  }

  return ok({
    offer: draft,
    serviceIds: [ranked.serviceId],
    locationIds: [],
  });
};

export const getOrCreateDraftOffer = (
  db: DbConnection,
  input: GetOrCreateDraftOfferInput
) =>
  trackedResult(
    'claire.draftState.getOrCreateDraftOffer',
    () => getOrCreateDraftOfferImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
      },
    }
  );

export type GetOrCreateDraftOfferResult = Awaited<
  ReturnType<typeof getOrCreateDraftOffer>
>;
