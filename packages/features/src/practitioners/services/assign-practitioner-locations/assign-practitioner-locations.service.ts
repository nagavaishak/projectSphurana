import {
  organizationLocation,
  practitioner,
  practitionerLocation,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
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
  type AssignPractitionerLocationsInput,
  type LocationAssignment,
  assignPractitionerLocationsSchema,
} from './assign-practitioner-locations.schema.js';

const assignPractitionerLocationsImpl = async (
  db: DbConnection,
  input: AssignPractitionerLocationsInput
): Promise<
  Result<{ practitionerId: string; locations: LocationAssignment[] }>
> => {
  const parsed = assignPractitionerLocationsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { practitionerId, organizationId, locations } = parsed.data;

  // Verify practitioner exists and belongs to org
  const existing = await db.query.practitioner.findFirst({
    where: and(
      eq(practitioner.id, practitionerId),
      eq(practitioner.organizationId, organizationId),
      notDeleted(practitioner)
    ),
  });

  if (!existing) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Practitioner not found')
    );
  }

  // Verify all locations belong to the same org
  const locationIds = locations.map((l) => l.locationId);
  if (locationIds.length > 0) {
    const orgLocations = await db.query.organizationLocation.findMany({
      where: and(
        inArray(organizationLocation.id, locationIds),
        eq(organizationLocation.organizationId, organizationId)
      ),
    });

    if (orgLocations.length !== locationIds.length) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'One or more locations not found'
        )
      );
    }
  }

  try {
    // Delete existing assignments
    await db
      .delete(practitionerLocation)
      .where(eq(practitionerLocation.practitionerId, practitionerId));

    // Insert new assignments with working hours
    if (locations.length > 0) {
      await db.insert(practitionerLocation).values(
        locations.map(({ locationId, workingHours }) => ({
          practitionerId,
          locationId,
          workingHours: workingHours ?? null,
        }))
      );
    }

    return ok({ practitionerId, locations });
  } catch (error) {
    logError('practitioners.assignPractitionerLocations', error, {
      feature: 'practitioners',
      extra: { practitionerId, locationIds },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to assign locations')
    );
  }
};

export const assignPractitionerLocations = (
  db: DbConnection,
  input: AssignPractitionerLocationsInput
) =>
  trackedResult(
    'practitioners.assignPractitionerLocations',
    () =>
      withOrgScope((tx) => assignPractitionerLocationsImpl(tx, input), { db }),
    { properties: { practitionerId: input.practitionerId } }
  );

export type AssignPractitionerLocationsResult = Awaited<
  ReturnType<typeof assignPractitionerLocations>
>;
