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
  err,
  ok,
} from '../../../shared/index.js';
import {
  type AssignMembershipPlanLocationsInput,
  assignMembershipPlanLocationsSchema,
} from './assign-membership-plan-locations.schema.js';

/**
 * Replace which branches sold a membership plan.
 *
 * THE ONE THING TO KNOW: **an empty `locationIds` array means "sold at every
 * branch", not "sold nowhere."** Zero join rows is the "everywhere" default
 * the read path is built on (`atLocationOrUnassigned`), and the only convention
 * under which this table could ship EMPTY without blanking the catalogue the
 * day branch filtering switched on. `[]` is how an owner UNDOES a per-branch
 * restriction; "available nowhere" is `isActive: false`, not this.
 *
 * A full REPLACE, matching `assignPractitionerLocations` and
 * `assignServiceLocations`.
 */
const assignMembershipPlanLocationsImpl = async (
  db: DbConnection,
  input: AssignMembershipPlanLocationsInput
): Promise<Result<{ planId: string; locationIds: string[] }>> => {
  const parsed = assignMembershipPlanLocationsSchema.safeParse(input);
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
    await db
      .delete(membershipPlanLocation)
      .where(eq(membershipPlanLocation.planId, planId));

    if (locationIds.length > 0) {
      // De-duplicated: the unique constraint would reject a repeated id, and a
      // body listing one branch twice is a client bug, not a conflict worth
      // surfacing as a 409.
      await db.insert(membershipPlanLocation).values(
        [...new Set(locationIds)].map((locationId) => ({
          planId: planId,
          locationId,
        }))
      );
    }

    return ok({ planId, locationIds });
  } catch (error) {
    logError('memberships.assignMembershipPlanLocations', error, {
      feature: 'memberships',
      extra: { planId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to assign membership plan locations'
      )
    );
  }
};

export const assignMembershipPlanLocations = (
  db: DbConnection,
  input: AssignMembershipPlanLocationsInput
) =>
  trackedResult(
    'memberships.assignMembershipPlanLocations',
    () =>
      withOrgScope((tx) => assignMembershipPlanLocationsImpl(tx, input), {
        db,
      }),
    { properties: { planId: input.planId } }
  );

export type AssignMembershipPlanLocationsResult = Awaited<
  ReturnType<typeof assignMembershipPlanLocations>
>;
