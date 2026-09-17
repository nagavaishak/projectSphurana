import {
  isUniqueViolation,
  offer,
  offerLocation,
  offerService,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type CreateOfferInput,
  createOfferSchema,
} from './create-offer.schema.js';

/**
 * Internal implementation of create offer.
 *
 * Inserts the offer row, then links the picked services and locations via
 * the `offer_service` / `offer_location` junctions. An empty `locationIds`
 * array means "applies to all org locations" — no junction rows written.
 *
 * Per-org case-insensitive uniqueness on `code` is enforced by the partial
 * unique index `idx_offer_org_code_unique` — duplicate codes surface as
 * `ALREADY_EXISTS`.
 */
const createOfferImpl = async (
  db: DbConnection,
  input: CreateOfferInput
): Promise<Result<typeof offer.$inferSelect>> => {
  const parsed = createOfferSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { serviceIds, locationIds, ...offerData } = parsed.data;

  try {
    const [result] = await db
      .insert(offer)
      .values({
        organizationId: offerData.organizationId,
        name: offerData.name,
        description: offerData.description ?? null,
        code: offerData.code,
        state: offerData.state,
        discountType: offerData.discountType,
        discountPercent: offerData.discountPercent ?? null,
        discountAmountCents: offerData.discountAmountCents ?? null,
        originalPriceCents: offerData.originalPriceCents ?? null,
        offerPriceCents: offerData.offerPriceCents ?? null,
        buyQuantity: offerData.buyQuantity ?? null,
        getQuantity: offerData.getQuantity ?? null,
        limitPerClient: offerData.limitPerClient,
        redemptionLimit: offerData.redemptionLimit ?? null,
        validFrom: offerData.validFrom ?? null,
        validUntil: offerData.validUntil ?? null,
      })
      .returning();

    if (serviceIds.length > 0) {
      await db.insert(offerService).values(
        serviceIds.map((serviceId) => ({
          offerId: result.id,
          serviceId,
        }))
      );
    }

    if (locationIds.length > 0) {
      await db.insert(offerLocation).values(
        locationIds.map((locationId) => ({
          offerId: result.id,
          locationId,
        }))
      );
    }

    return ok(result);
  } catch (error) {
    // drizzle wraps the postgres.js error — the constraint lives on the
    // `.cause` chain, not `error.message` (see isUniqueViolation). Three
    // distinct unique constraints can fire here: the offer's own code
    // (idx_offer_org_code_unique), or a duplicate serviceId/locationId in the
    // offerService/offerLocation batch inserts above.
    if (isUniqueViolation(error, 'idx_offer_org_code_unique')) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          'An offer with that code already exists in this organization',
          { code: offerData.code ?? null }
        )
      );
    }
    if (
      isUniqueViolation(error, 'offer_service_unique') ||
      isUniqueViolation(error, 'offer_location_unique')
    ) {
      return err(
        new FeatureError(ErrorCodes.ALREADY_EXISTS, 'Offer already exists')
      );
    }

    logError('offers.createOffer', error, {
      feature: 'offers',
      extra: { organizationId: offerData.organizationId, name: offerData.name },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to create offer')
    );
  }
};

export const createOffer = (db: DbConnection, input: CreateOfferInput) =>
  trackedResult(
    'offers.createOffer',
    () => withOrgScope((tx) => createOfferImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId, name: input.name },
    }
  );

export type CreateOfferResult = Awaited<ReturnType<typeof createOffer>>;
