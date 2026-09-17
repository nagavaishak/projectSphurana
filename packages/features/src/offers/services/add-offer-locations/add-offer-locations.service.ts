import {
  offer,
  offerLocation,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { assertLocationsBelongToOrg } from '../../../organization-locations/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  addLocationLinks,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type AddOfferLocationsInput,
  addOfferLocationsSchema,
} from './add-offer-locations.schema.js';

/**
 * Also run this promotion at these branches — the write behind "import from
 * another location".
 *
 * ADDITIVE, unlike `assign…Locations`, which REPLACES the whole set. The rules
 * that make an add correct (a promotion available everywhere must not be
 * narrowed; a re-sent import must not 409) live in `addLocationLinks`, shared
 * with the other join tables.
 */
const addOfferLocationsImpl = async (
  db: DbConnection,
  input: AddOfferLocationsInput
): Promise<Result<{ offerId: string; locationIds: string[] }>> => {
  const parsed = addOfferLocationsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { offerId, organizationId, locationIds } = parsed.data;

  const existing = await db.query.offer.findFirst({
    where: and(eq(offer.id, offerId), eq(offer.organizationId, organizationId)),
    columns: { id: true },
  });

  if (!existing) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Offer not found'));
  }

  // The branch ids come from the request body — see the note on
  // `assertLocationsBelongToOrg` for why this is a hard failure.
  const owned = await assertLocationsBelongToOrg(db, {
    organizationId,
    locationIds,
  });
  if (!owned.success) return err(owned.error);

  try {
    const linked = await addLocationLinks(db, offerLocation, {
      ownerColumn: offerLocation.offerId,
      ownerId: offerId,
      locationColumn: offerLocation.locationId,
      locationIds,
      buildRow: (locationId) => ({ offerId: offerId, locationId }),
    });

    return ok({ offerId, locationIds: linked });
  } catch (error) {
    logError('offers.addOfferLocations', error, {
      feature: 'offers',
      extra: { offerId, organizationId, locationIds },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to add promotion locations'
      )
    );
  }
};

export const addOfferLocations = (
  db: DbConnection,
  input: AddOfferLocationsInput
) =>
  trackedResult(
    'offers.addOfferLocations',
    () => withOrgScope((tx) => addOfferLocationsImpl(tx, input), { db }),
    { properties: { offerId: input.offerId } }
  );

export type AddOfferLocationsResult = Awaited<
  ReturnType<typeof addOfferLocations>
>;
