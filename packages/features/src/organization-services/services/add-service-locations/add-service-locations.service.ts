import {
  organizationService,
  organizationServiceLocation,
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
  type AddServiceLocationsInput,
  addServiceLocationsSchema,
} from './add-service-locations.schema.js';

/**
 * Also offer this service at these branches — the write behind "import from
 * another location".
 *
 * ADDITIVE, unlike `assignServiceLocations`, which REPLACES the whole set. A
 * caller adding one branch through the replace endpoint has to send back every
 * existing entry, and the per-branch `priceCentsOverride` it would need for
 * that is not exposed on any read path — so it sends nulls and silently blanks
 * a branch's price. This endpoint cannot make that mistake: it only ever
 * inserts.
 *
 * TWO RULES CARRY THE CORRECTNESS:
 *
 * 1. **Zero rows means offered EVERYWHERE** (`atLocationOrUnassigned`). So
 *    adding a branch to a service that has no rows is a NO-OP — inserting the
 *    one row would NARROW the service from "every branch" to "just this one",
 *    turning an import into an outage at every other branch. The UI never
 *    offers such a service, but an endpoint must not depend on a caller's
 *    discipline for that.
 * 2. **Idempotent.** The join table is unique on (service, location), and a
 *    re-sent import must not 409 — the user's mental model is "make sure it's
 *    offered here", which is already true.
 */
const addServiceLocationsImpl = async (
  db: DbConnection,
  input: AddServiceLocationsInput
): Promise<Result<{ serviceId: string; locationIds: string[] }>> => {
  const parsed = addServiceLocationsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { serviceId, organizationId, locationIds } = parsed.data;

  const existingService = await db.query.organizationService.findFirst({
    where: and(
      eq(organizationService.id, serviceId),
      eq(organizationService.organizationId, organizationId)
    ),
    columns: { id: true },
  });

  if (!existingService) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Service not found'));
  }

  // The branch ids come from the request body — see the note on
  // `assertLocationsBelongToOrg` for why this is a hard failure.
  const owned = await assertLocationsBelongToOrg(db, {
    organizationId,
    locationIds,
  });
  if (!owned.success) return err(owned.error);

  try {
    // Both rules live in `addLocationLinks`, shared with the other four join
    // tables — a per-entity copy is exactly where the everywhere-no-op gets
    // lost.
    const linked = await addLocationLinks(db, organizationServiceLocation, {
      ownerColumn: organizationServiceLocation.serviceId,
      ownerId: serviceId,
      locationColumn: organizationServiceLocation.locationId,
      locationIds,
      buildRow: (locationId) => ({
        serviceId,
        locationId,
        // A NEW branch inherits the catalogue price. An override is a
        // deliberate later edit, never something an import invents.
        priceCentsOverride: null,
        durationMinutesOverride: null,
      }),
    });

    return ok({ serviceId, locationIds: linked });
  } catch (error) {
    logError('organizationServices.addServiceLocations', error, {
      feature: 'organization-services',
      extra: { serviceId, organizationId, locationIds },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to add service locations'
      )
    );
  }
};

export const addServiceLocations = (
  db: DbConnection,
  input: AddServiceLocationsInput
) =>
  trackedResult(
    'organizationServices.addServiceLocations',
    () => withOrgScope((tx) => addServiceLocationsImpl(tx, input), { db }),
    { properties: { serviceId: input.serviceId } }
  );

export type AddServiceLocationsResult = Awaited<
  ReturnType<typeof addServiceLocations>
>;
