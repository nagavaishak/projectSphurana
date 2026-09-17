import { type Offer, offer } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../shared/index.js';
import {
  type PromoteDraftOfferInput,
  promoteDraftOfferSchema,
} from './draft-offer.schema.js';

/**
 * Promote a chat-owned draft offer to `state='active'`.
 *
 * Unlike the ad path, offer promotion is a simple state flip — there is
 * no external integration to call. The junction rows (services /
 * locations) carry over unchanged.
 */
const promoteDraftOfferImpl = async (
  db: DbConnection,
  input: PromoteDraftOfferInput
): Promise<Result<Offer>> => {
  const parsed = promoteDraftOfferSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, draftId } = parsed.data;

  const existing = await db.query.offer.findFirst({
    where: and(
      eq(offer.id, draftId),
      eq(offer.organizationId, organizationId),
      notDeleted(offer)
    ),
  });
  if (!existing) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Draft offer not found'));
  }
  if (existing.state !== 'draft') {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'Offer has already been promoted; nothing to publish.'
      )
    );
  }

  // Validate required fields per discount type. The Zod schema on the
  // update path enforces this when discountType changes, but here we
  // re-check because the draft might have been created with one shape and
  // never updated.
  if (
    existing.discountType === 'percentage' &&
    existing.discountPercent == null
  ) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'Percentage offers require discountPercent before publishing.'
      )
    );
  }
  if (
    existing.discountType === 'fixed_price' &&
    existing.offerPriceCents == null
  ) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'Fixed-price offers require offerPriceCents before publishing.'
      )
    );
  }
  if (
    existing.discountType === 'buy_x_get_y' &&
    (existing.buyQuantity == null || existing.getQuantity == null)
  ) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'Buy-X-get-Y offers require buyQuantity and getQuantity before publishing.'
      )
    );
  }

  const [updated] = await db
    .update(offer)
    .set({ state: 'active', updatedAt: new Date() })
    .where(and(eq(offer.id, draftId), notDeleted(offer)))
    .returning();
  if (!updated) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to promote draft offer'
      )
    );
  }
  return ok(updated);
};

export const promoteDraftOffer = (
  db: DbConnection,
  input: PromoteDraftOfferInput
) =>
  trackedResult(
    'claire.draftState.promoteDraftOffer',
    () => promoteDraftOfferImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        draftId: input.draftId,
      },
    }
  );

export type PromoteDraftOfferResult = Awaited<
  ReturnType<typeof promoteDraftOffer>
>;
