import {
  membershipPlan,
  membershipPlanLocation,
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
  type RemoveMembershipPlanLocationInput,
  removeMembershipPlanLocationSchema,
} from './remove-membership-plan-location.schema.js';

/**
 * Stop sold this membership plan at ONE branch, leaving it in place everywhere else
 * — the "remove from this location" half of the delete prompt.
 *
 * The awkward case (a membership plan with no assignments is sold EVERYWHERE, so
 * removal has to materialise the complement) lives in `removeLocationLink`,
 * shared with the other join tables.
 *
 * Removing the LAST branch is refused with CONFLICT rather than performed: zero
 * rows reads as "every branch", so writing it back would re-publish the very
 * thing the operator asked to withdraw. Deactivating is how a business takes
 * something off sale everywhere.
 */
const removeMembershipPlanLocationImpl = async (
  db: DbConnection,
  input: RemoveMembershipPlanLocationInput
): Promise<Result<{ planId: string; locationIds: string[] }>> => {
  const parsed = removeMembershipPlanLocationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { planId, locationId, organizationId } = parsed.data;

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

    const remaining = await removeLocationLink(db, membershipPlanLocation, {
      ownerColumn: membershipPlanLocation.planId,
      ownerId: planId,
      locationColumn: membershipPlanLocation.locationId,
      locationId,
      orgLocationIds: orgLocations.data.items.map((l) => l.id),
      buildRow: (id) => ({ planId: planId, locationId: id }),
    });

    if (remaining === null) {
      return err(
        new FeatureError(
          ErrorCodes.CONFLICT,
          'This is the last location. Deactivate it instead of removing the last branch.'
        )
      );
    }

    return ok({ planId, locationIds: remaining });
  } catch (error) {
    logError('memberships.removeMembershipPlanLocation', error, {
      feature: 'memberships',
      extra: { planId, locationId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to remove membership plan location'
      )
    );
  }
};

export const removeMembershipPlanLocation = (
  db: DbConnection,
  input: RemoveMembershipPlanLocationInput
) =>
  trackedResult(
    'memberships.removeMembershipPlanLocation',
    () =>
      withOrgScope((tx) => removeMembershipPlanLocationImpl(tx, input), { db }),
    { properties: { planId: input.planId, locationId: input.locationId } }
  );

export type RemoveMembershipPlanLocationResult = Awaited<
  ReturnType<typeof removeMembershipPlanLocation>
>;
