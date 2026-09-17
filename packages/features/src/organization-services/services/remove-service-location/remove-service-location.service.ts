import {
  organizationService,
  organizationServiceLocation,
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
  type RemoveServiceLocationInput,
  removeServiceLocationSchema,
} from './remove-service-location.schema.js';

/**
 * Stop offered this service at ONE branch, leaving it in place everywhere else
 * — the "remove from this location" half of the delete prompt.
 *
 * The awkward case (a service with no assignments is offered EVERYWHERE, so
 * removal has to materialise the complement) lives in `removeLocationLink`,
 * shared with the other join tables.
 *
 * Removing the LAST branch is refused with CONFLICT rather than performed: zero
 * rows reads as "every branch", so writing it back would re-publish the very
 * thing the operator asked to withdraw. Deactivating is how a business takes
 * something off sale everywhere.
 */
const removeServiceLocationImpl = async (
  db: DbConnection,
  input: RemoveServiceLocationInput
): Promise<Result<{ serviceId: string; locationIds: string[] }>> => {
  const parsed = removeServiceLocationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { serviceId, locationId, organizationId } = parsed.data;

  const existing = await db.query.organizationService.findFirst({
    where: and(
      eq(organizationService.id, serviceId),
      eq(organizationService.organizationId, organizationId)
    ),
    columns: { id: true },
  });

  if (!existing) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Service not found'));
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

    const remaining = await removeLocationLink(
      db,
      organizationServiceLocation,
      {
        ownerColumn: organizationServiceLocation.serviceId,
        ownerId: serviceId,
        locationColumn: organizationServiceLocation.locationId,
        locationId,
        orgLocationIds: orgLocations.data.items.map((l) => l.id),
        buildRow: (id) => ({ serviceId: serviceId, locationId: id }),
      }
    );

    if (remaining === null) {
      return err(
        new FeatureError(
          ErrorCodes.CONFLICT,
          'This is the last location. Deactivate it instead of removing the last branch.'
        )
      );
    }

    return ok({ serviceId, locationIds: remaining });
  } catch (error) {
    logError('organizationServices.removeServiceLocation', error, {
      feature: 'organization-services',
      extra: { serviceId, locationId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to remove service location'
      )
    );
  }
};

export const removeServiceLocation = (
  db: DbConnection,
  input: RemoveServiceLocationInput
) =>
  trackedResult(
    'organizationServices.removeServiceLocation',
    () => withOrgScope((tx) => removeServiceLocationImpl(tx, input), { db }),
    { properties: { serviceId: input.serviceId, locationId: input.locationId } }
  );

export type RemoveServiceLocationResult = Awaited<
  ReturnType<typeof removeServiceLocation>
>;
