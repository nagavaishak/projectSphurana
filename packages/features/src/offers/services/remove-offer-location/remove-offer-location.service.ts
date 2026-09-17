import {
  offer,
  offerLocation,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { listLocations } from '../../../organization-locations/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
  removeLocationLink,
} from '../../../shared/index.js';
import {
  type RemoveOfferLocationInput,
  removeOfferLocationSchema,
} from './remove-offer-location.schema.js';

/**
 * Stop run this promotion at ONE branch, leaving it in place everywhere else
 * — the "remove from this location" half of the delete prompt.
 *
 * The awkward case (a promotion with no assignments is run EVERYWHERE, so
 * removal has to materialise the complement) lives in `removeLocationLink`,
 * shared with the other join tables.
 *
 * Removing the LAST branch is refused with CONFLICT rather than performed: zero
 * rows reads as "every branch", so writing it back would re-publish the very
 * thing the operator asked to withdraw. Deactivating is how a business takes
 * something off sale everywhere.
 */
const removeOfferLocationImpl = async (
  db: DbConnection,
  input: RemoveOfferLocationInput
): Promise<Result<{ offerId: string; locationIds: string[] }>> => {
  const parsed = removeOfferLocationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { offerId, locationId, organizationId } = parsed.data;

  const existing = await db.query.offer.findFirst({
    where: and(eq(offer.id, offerId), eq(offer.organizationId, organizationId)),
    columns: { id: true },
  });

  if (!existing) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Offer not found'));
  }

  try {
    // Only needed for the materialise case, but read up front so the helper
    // stays ignorant of how branches are listed.
    const orgLocations = await listLocations(db, { organizationId });
    if (!orgLocations.success) {
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'Failed to read the organisation’s locations'
        )
      );
    }

    const remaining = await removeLocationLink(db, offerLocation, {
      ownerColumn: offerLocation.offerId,
      ownerId: offerId,
      locationColumn: offerLocation.locationId,
      locationId,
      orgLocationIds: orgLocations.data.items.map((l) => l.id),
      buildRow: (id) => ({ offerId: offerId, locationId: id }),
    });

    if (remaining === null) {
      return err(
        new FeatureError(
          ErrorCodes.CONFLICT,
          'This is the last location. Deactivate it instead of removing the last branch.'
        )
      );
    }

    return ok({ offerId, locationIds: remaining });
  } catch (error) {
    logError('offers.removeOfferLocation', error, {
      feature: 'offers',
      extra: { offerId, locationId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to remove promotion location'
      )
    );
  }
};

export const removeOfferLocation = (
  db: DbConnection,
  input: RemoveOfferLocationInput
) =>
  trackedResult(
    'offers.removeOfferLocation',
    () => withOrgScope((tx) => removeOfferLocationImpl(tx, input), { db }),
    { properties: { offerId: input.offerId, locationId: input.locationId } }
  );

export type RemoveOfferLocationResult = Awaited<
  ReturnType<typeof removeOfferLocation>
>;
