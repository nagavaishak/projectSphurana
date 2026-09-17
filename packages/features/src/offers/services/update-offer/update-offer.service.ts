import {
  isUniqueViolation,
  offer,
  offerLocation,
  offerService,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
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
  PAST_GRACE_MS,
  pastValidUntilMessage,
} from '../offer-validity-issues.js';
import {
  type UpdateOfferInput,
  updateOfferSchema,
} from './update-offer.schema.js';

/**
 * Internal implementation of update offer.
 *
 * Only fields explicitly present in the input are updated. `serviceIds` /
 * `locationIds`, when provided, replace the entire set of junction rows for
 * that relation; omitting them leaves existing links untouched.
 */
const updateOfferImpl = async (
  db: DbConnection,
  input: UpdateOfferInput
): Promise<Result<typeof offer.$inferSelect>> => {
  const parsed = updateOfferSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId, serviceIds, locationIds, ...updates } =
    parsed.data;

  const existing = await db.query.offer.findFirst({
    where: and(
      eq(offer.id, id),
      eq(offer.organizationId, organizationId),
      notDeleted(offer)
    ),
  });

  if (!existing) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Offer not found', { id })
    );
  }

  // Time-correctness backstop (Phase 3): an update may not MOVE an offer's end
  // into the past (register #158 — a date-blind model extending an offer to a
  // 2025 date). Checked here rather than in the schema because the offer edit
  // dialog round-trips the stored `validUntil` in a full-body PUT: an
  // unchanged echo must keep working, or an expired offer could never be
  // edited again. Use `state: 'expired'` to end an offer early.
  if (
    updates.validUntil != null &&
    updates.validUntil.getTime() < Date.now() - PAST_GRACE_MS &&
    updates.validUntil.getTime() !== existing.validUntil?.getTime()
  ) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: [
          {
            code: 'custom',
            path: ['validUntil'],
            message: pastValidUntilMessage(updates.validUntil),
          },
        ],
      })
    );
  }

  try {
    const updateData: Partial<typeof offer.$inferInsert> = {};
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.description !== undefined)
      updateData.description = updates.description;
    if (updates.code !== undefined) updateData.code = updates.code;
    if (updates.state !== undefined) updateData.state = updates.state;
    if (updates.discountType !== undefined)
      updateData.discountType = updates.discountType;
    if (updates.discountPercent !== undefined)
      updateData.discountPercent = updates.discountPercent;
    if (updates.discountAmountCents !== undefined)
      updateData.discountAmountCents = updates.discountAmountCents;
    if (updates.originalPriceCents !== undefined)
      updateData.originalPriceCents = updates.originalPriceCents;
    if (updates.offerPriceCents !== undefined)
      updateData.offerPriceCents = updates.offerPriceCents;
    if (updates.buyQuantity !== undefined)
      updateData.buyQuantity = updates.buyQuantity;
    if (updates.getQuantity !== undefined)
      updateData.getQuantity = updates.getQuantity;
    if (updates.limitPerClient !== undefined)
      updateData.limitPerClient = updates.limitPerClient;
    if (updates.redemptionLimit !== undefined)
      updateData.redemptionLimit = updates.redemptionLimit;
    if (updates.validFrom !== undefined)
      updateData.validFrom = updates.validFrom;
    if (updates.validUntil !== undefined)
      updateData.validUntil = updates.validUntil;

    const [result] = await db
      .update(offer)
      .set(updateData)
      .where(
        and(
          eq(offer.id, id),
          eq(offer.organizationId, organizationId),
          notDeleted(offer)
        )
      )
      .returning();

    if (serviceIds !== undefined) {
      await db.delete(offerService).where(eq(offerService.offerId, id));
      if (serviceIds.length > 0) {
        await db.insert(offerService).values(
          serviceIds.map((serviceId) => ({
            offerId: id,
            serviceId,
          }))
        );
      }
    }

    if (locationIds !== undefined) {
      await db.delete(offerLocation).where(eq(offerLocation.offerId, id));
      if (locationIds.length > 0) {
        await db.insert(offerLocation).values(
          locationIds.map((locationId) => ({
            offerId: id,
            locationId,
          }))
        );
      }
    }

    return ok(result);
  } catch (error) {
    // drizzle wraps the postgres.js error — the constraint lives on the
    // `.cause` chain, not `error.message` (see isUniqueViolation).
    if (isUniqueViolation(error, 'idx_offer_org_code_unique')) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          'An offer with that code already exists in this organization',
          { code: updates.code ?? null }
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

    logError('offers.updateOffer', error, {
      feature: 'offers',
      extra: { id, organizationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to update offer')
    );
  }
};

export const updateOffer = (db: DbConnection, input: UpdateOfferInput) =>
  trackedResult(
    'offers.updateOffer',
    () => withOrgScope((tx) => updateOfferImpl(tx, input), { db }),
    {
      properties: { id: input.id, organizationId: input.organizationId },
    }
  );

export type UpdateOfferResult = Awaited<ReturnType<typeof updateOffer>>;
