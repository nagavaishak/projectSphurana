import {
  membershipPlanLocation,
  offerLocation,
  organizationServiceLocation,
  practitionerLocation,
  productLocation,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { assertLocationsBelongToOrg } from '../assert-locations-belong-to-org/index.js';
import {
  type GetLocationCatalogInput,
  type LocationCatalog,
  getLocationCatalogSchema,
} from './get-location-catalog.schema.js';

/**
 * Read the ids EXPLICITLY assigned to one branch — the state the edit screen
 * ticks, and the exact shape `applyLocationCatalog` writes back.
 *
 * Deliberately the join rows and nothing else. Asking the list endpoints "what
 * is available at this branch?" would answer with the union of the explicitly
 * assigned AND everything unrestricted, which is the right answer for a
 * customer-facing catalogue and the wrong one for an editor: saving that union
 * back would restrict every unrestricted entity in the org to this branch.
 */
const getLocationCatalogImpl = async (
  db: DbConnection,
  input: GetLocationCatalogInput
): Promise<Result<LocationCatalog>> => {
  const parsed = getLocationCatalogSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { locationId, organizationId } = parsed.data;

  const owned = await assertLocationsBelongToOrg(db, {
    organizationId,
    locationIds: [locationId],
  });
  if (!owned.success) return err(owned.error);

  try {
    const [practitioners, services, products, plans, offers] =
      await Promise.all([
        db
          .select({ id: practitionerLocation.practitionerId })
          .from(practitionerLocation)
          .where(eq(practitionerLocation.locationId, locationId)),
        db
          .select({ id: organizationServiceLocation.serviceId })
          .from(organizationServiceLocation)
          .where(eq(organizationServiceLocation.locationId, locationId)),
        db
          .select({ id: productLocation.productId })
          .from(productLocation)
          .where(eq(productLocation.locationId, locationId)),
        db
          .select({ id: membershipPlanLocation.planId })
          .from(membershipPlanLocation)
          .where(eq(membershipPlanLocation.locationId, locationId)),
        db
          .select({ id: offerLocation.offerId })
          .from(offerLocation)
          .where(eq(offerLocation.locationId, locationId)),
      ]);

    const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

    return ok({
      practitionerIds: ids(practitioners),
      serviceIds: ids(services),
      productIds: ids(products),
      membershipPlanIds: ids(plans),
      offerIds: ids(offers),
    });
  } catch (error) {
    logError('organizationLocations.getLocationCatalog', error, {
      feature: 'organization-locations',
      extra: { locationId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        "Failed to load the location's catalogue"
      )
    );
  }
};

export const getLocationCatalog = (
  db: DbConnection,
  input: GetLocationCatalogInput
) =>
  trackedResult(
    'organizationLocations.getLocationCatalog',
    () => withOrgScope((tx) => getLocationCatalogImpl(tx, input), { db }),
    { properties: { locationId: input.locationId }, internalErrorsOnly: true }
  );

export type GetLocationCatalogResult = Awaited<
  ReturnType<typeof getLocationCatalog>
>;
