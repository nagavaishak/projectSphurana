import {
  practitioner,
  practitionerLocation,
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
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type AddPractitionerLocationsInput,
  addPractitionerLocationsSchema,
} from './add-practitioner-locations.schema.js';

/**
 * Also let this person work at these branches — the write behind "add someone
 * who already works at another location".
 *
 * ADDITIVE, unlike `assignPractitionerLocations`, which REPLACES the set. That
 * distinction matters more here than anywhere else in the catalogue: a replace
 * that arrives with a short list REMOVES someone from a branch, and a
 * practitioner's branches decide where their appointments can be booked. An
 * endpoint that can only add cannot strand a booked-out week.
 *
 * The everywhere-no-op and idempotence rules live in `addLocationLinks`, shared
 * with the catalogue join tables — practitioners read through the same
 * `atLocationOrUnassigned` predicate, so zero rows means "works at every
 * branch" here too.
 */
const addPractitionerLocationsImpl = async (
  db: DbConnection,
  input: AddPractitionerLocationsInput
): Promise<Result<{ practitionerId: string; locationIds: string[] }>> => {
  const parsed = addPractitionerLocationsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { practitionerId, organizationId, locationIds } = parsed.data;

  const existing = await db.query.practitioner.findFirst({
    where: and(
      eq(practitioner.id, practitionerId),
      eq(practitioner.organizationId, organizationId),
      notDeleted(practitioner)
    ),
    columns: { id: true },
  });

  if (!existing) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Practitioner not found')
    );
  }

  // The branch ids come from the request body — see the note on
  // `assertLocationsBelongToOrg` for why this is a hard failure.
  const owned = await assertLocationsBelongToOrg(db, {
    organizationId,
    locationIds,
  });
  if (!owned.success) return err(owned.error);

  try {
    const linked = await addLocationLinks(db, practitionerLocation, {
      ownerColumn: practitionerLocation.practitionerId,
      ownerId: practitionerId,
      locationColumn: practitionerLocation.locationId,
      locationIds,
      buildRow: (locationId) => ({ practitionerId, locationId }),
    });

    return ok({ practitionerId, locationIds: linked });
  } catch (error) {
    logError('practitioners.addPractitionerLocations', error, {
      feature: 'practitioners',
      extra: { practitionerId, organizationId, locationIds },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to add practitioner locations'
      )
    );
  }
};

export const addPractitionerLocations = (
  db: DbConnection,
  input: AddPractitionerLocationsInput
) =>
  trackedResult(
    'practitioners.addPractitionerLocations',
    () => withOrgScope((tx) => addPractitionerLocationsImpl(tx, input), { db }),
    { properties: { practitionerId: input.practitionerId } }
  );

export type AddPractitionerLocationsResult = Awaited<
  ReturnType<typeof addPractitionerLocations>
>;
