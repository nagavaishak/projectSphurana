import {
  offer,
  offerLocation,
  offerService,
  withOrgScope,
} from '@borradh-workspace/database';
import {
  isFeatureOn,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  logAuditEvent,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type DeleteOfferInput,
  deleteOfferSchema,
} from './delete-offer.schema.js';

/**
 * Internal implementation of delete offer (runs inside withOrgScope transaction)
 */
const deleteOfferImpl = async (
  db: DbConnection,
  input: DeleteOfferInput
): Promise<Result<{ success: true }>> => {
  // Validate input
  const parsed = deleteOfferSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId } = parsed.data;

  if (!(await isFeatureOn('killswitch-soft-deletes'))) {
    await db
      .delete(offer)
      .where(and(eq(offer.id, id), eq(offer.organizationId, organizationId)));
    return ok({ success: true });
  }

  // Check if offer exists
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

  await db
    .update(offer)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(offer.id, id),
        eq(offer.organizationId, organizationId),
        notDeleted(offer)
      )
    );

  // Hard-delete junction rows: soft-delete does not trigger FK CASCADE,
  // so we must remove offer_service / offer_location rows explicitly.
  await Promise.all([
    db.delete(offerService).where(eq(offerService.offerId, id)),
    db.delete(offerLocation).where(eq(offerLocation.offerId, id)),
  ]);

  return ok({ success: true });
};

/**
 * Delete an offer (cascade deletes service links)
 */
export const deleteOffer = async (
  db: DbConnection,
  input: DeleteOfferInput
) => {
  const result = await trackedResult(
    'offers.deleteOffer',
    () => withOrgScope((tx) => deleteOfferImpl(tx, input), { db }),
    {
      properties: { id: input.id, organizationId: input.organizationId },
    }
  );
  // Audit log fires after transaction commits — safe from phantom entries on rollback
  if (result.success) {
    logAuditEvent(db, {
      action: 'delete',
      entityType: 'offer',
      entityId: input.id,
      actorType: 'user',
      actorId: input.actorId ?? null,
      organizationId: input.organizationId,
    }).catch((error) => {
      logError('offers.deleteOffer.auditLog', error, {
        feature: 'offers',
        extra: { id: input.id, organizationId: input.organizationId },
      });
    });
  }
  return result;
};

/**
 * Result type for deleteOffer
 */
export type DeleteOfferResult = Awaited<ReturnType<typeof deleteOffer>>;
