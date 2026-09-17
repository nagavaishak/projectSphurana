import {
  metaAdService,
  offer,
  offerService,
  organizationService,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray } from 'drizzle-orm';
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
  type DeleteServiceInput,
  deleteServiceSchema,
} from './delete-service.schema.js';

/**
 * Internal implementation of delete service
 */
const deleteServiceImpl = async (
  db: DbConnection,
  input: DeleteServiceInput
): Promise<Result<{ success: true }>> => {
  // Validate input
  const parsed = deleteServiceSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId } = parsed.data;

  // Check if service exists
  const existing = await db.query.organizationService.findFirst({
    where: (svc, { eq: e, and: a }) =>
      a(e(svc.id, id), e(svc.organizationId, organizationId)),
  });

  if (!existing) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Service not found', { id })
    );
  }

  // Check if service is linked to any assets
  const linkedAssets = await db.query.assetService.findFirst({
    where: (as, { eq: e }) => e(as.serviceId, id),
  });

  if (linkedAssets) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'Cannot delete service that is linked to assets. Remove asset links first.',
        { id }
      )
    );
  }

  // Block deletion when a LIVE offer references the service. The junction is
  // ON DELETE CASCADE, so without this guard an active (redeemable) offer would
  // be silently unlinked from the service it promotes. Draft/expired offers are
  // not customer-facing, so those may cascade-unlink.
  const offerLinks = await db
    .select({ offerId: offerService.offerId })
    .from(offerService)
    .where(eq(offerService.serviceId, id));
  if (offerLinks.length > 0) {
    const activeOffer = await db.query.offer.findFirst({
      where: and(
        inArray(
          offer.id,
          offerLinks.map((l) => l.offerId)
        ),
        eq(offer.state, 'active'),
        notDeleted(offer)
      ),
    });
    if (activeOffer) {
      return err(
        new FeatureError(
          ErrorCodes.CONFLICT,
          'Cannot delete service that is used by an active offer. Expire or remove the offer first.',
          { id }
        )
      );
    }
  }

  // Block deletion when a NON-DRAFT (launched/live) ad references the service —
  // a live ad spends money promoting it. Draft ads may cascade-unlink.
  const adLinks = await db
    .select({ metaAdId: metaAdService.metaAdId })
    .from(metaAdService)
    .where(eq(metaAdService.serviceId, id));
  if (adLinks.length > 0) {
    const liveAd = await db.query.metaAd.findFirst({
      where: (ad, { and: a, ne: n, inArray: ia }) =>
        a(
          ia(
            ad.id,
            adLinks.map((l) => l.metaAdId)
          ),
          n(ad.status, 'draft')
        ),
    });
    if (liveAd) {
      return err(
        new FeatureError(
          ErrorCodes.CONFLICT,
          'Cannot delete service that is used by a live ad. Pause or remove the ad first.',
          { id }
        )
      );
    }
  }

  // Delete service
  await db
    .delete(organizationService)
    .where(
      and(
        eq(organizationService.id, id),
        eq(organizationService.organizationId, organizationId)
      )
    );

  return ok({ success: true });
};

/**
 * Delete an organization service
 *
 * @param db - Database connection
 * @param input - Delete service input
 * @returns Result with success or error
 */
export const deleteService = (db: DbConnection, input: DeleteServiceInput) =>
  trackedResult(
    'organizationServices.deleteService',
    () => withOrgScope((tx) => deleteServiceImpl(tx, input), { db }),
    {
      properties: { id: input.id, organizationId: input.organizationId },
      // CONFLICT guards (service in use by appointments/campaigns) are
      // expected conditions, not errors worth tracking as such.
      internalErrorsOnly: true,
    }
  );

/**
 * Result type for deleteService
 */
export type DeleteServiceResult = Awaited<ReturnType<typeof deleteService>>;
