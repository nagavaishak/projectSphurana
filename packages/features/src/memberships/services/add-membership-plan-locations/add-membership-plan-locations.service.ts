import {
  membershipPlan,
  membershipPlanLocation,
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
  type AddMembershipPlanLocationsInput,
  addMembershipPlanLocationsSchema,
} from './add-membership-plan-locations.schema.js';

/**
 * Also sold this membership plan at these branches — the write behind "import from
 * another location".
 *
 * ADDITIVE, unlike `assign…Locations`, which REPLACES the whole set. The rules
 * that make an add correct (a membership plan available everywhere must not be
 * narrowed; a re-sent import must not 409) live in `addLocationLinks`, shared
 * with the other join tables.
 */
const addMembershipPlanLocationsImpl = async (
  db: DbConnection,
  input: AddMembershipPlanLocationsInput
): Promise<Result<{ planId: string; locationIds: string[] }>> => {
  const parsed = addMembershipPlanLocationsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { planId, organizationId, locationIds } = parsed.data;

  const existing = await db.query.membershipPlan.findFirst({
    where: and(
      eq(membershipPlan.id, planId),
      eq(membershipPlan.organizationId, organizationId)
    ),
    columns: { id: true },
  });

  if (!existing) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Membership plan not found')
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
    const linked = await addLocationLinks(db, membershipPlanLocation, {
      ownerColumn: membershipPlanLocation.planId,
      ownerId: planId,
      locationColumn: membershipPlanLocation.locationId,
      locationIds,
      buildRow: (locationId) => ({ planId: planId, locationId }),
    });

    return ok({ planId, locationIds: linked });
  } catch (error) {
    logError('memberships.addMembershipPlanLocations', error, {
      feature: 'memberships',
      extra: { planId, organizationId, locationIds },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to add membership plan locations'
      )
    );
  }
};

export const addMembershipPlanLocations = (
  db: DbConnection,
  input: AddMembershipPlanLocationsInput
) =>
  trackedResult(
    'memberships.addMembershipPlanLocations',
    () =>
      withOrgScope((tx) => addMembershipPlanLocationsImpl(tx, input), { db }),
    { properties: { planId: input.planId } }
  );

export type AddMembershipPlanLocationsResult = Awaited<
  ReturnType<typeof addMembershipPlanLocations>
>;
