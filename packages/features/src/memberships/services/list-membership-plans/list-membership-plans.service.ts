import {
  type MembershipPlanLocation,
  type MembershipPlanService,
  membershipPlan,
  membershipPlanLocation,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { type SQL, and, desc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  atLocationOrUnassigned,
  err,
  ok,
} from '../../../shared/index.js';
import type { MembershipPlanWithServices } from '../../models/index.js';

/**
 * A listed plan plus the branches that sell it.
 *
 * EMPTY `locationIds` MEANS EVERYWHERE — the `atLocationOrUnassigned`
 * convention, not "sold nowhere". Only the LIST carries it (mirroring
 * `ListedService`): the import dialog needs to tell "already here" from
 * "available to copy", and the join table was never otherwise exposed.
 */
export type ListedMembershipPlan = MembershipPlanWithServices & {
  locationIds: string[];
};
import {
  type ListMembershipPlansInput,
  listMembershipPlansSchema,
} from './list-membership-plans.schema.js';

/**
 * List the org's membership plans (newest first) with covered service ids.
 */
const listMembershipPlansImpl = async (
  db: DbConnection,
  input: ListMembershipPlansInput
): Promise<Result<ListedMembershipPlan[]>> => {
  const parsed = listMembershipPlansSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, isActive, locationId } = parsed.data;

  try {
    const conditions: SQL[] = [
      eq(membershipPlan.organizationId, organizationId),
    ];
    if (isActive !== undefined) {
      conditions.push(eq(membershipPlan.isActive, isActive));
    }
    if (locationId) {
      conditions.push(
        atLocationOrUnassigned(
          db,
          membershipPlanLocation,
          membershipPlanLocation.planId,
          membershipPlan.id,
          membershipPlanLocation.locationId,
          locationId
        )
      );
    }

    const plans = await db.query.membershipPlan.findMany({
      where: and(...conditions),
      orderBy: [desc(membershipPlan.createdAt)],
      with: { services: true, planLocations: true },
    });

    return ok(
      plans.map((plan) => {
        const { services, planLocations, ...planFields } =
          plan as typeof plan & {
            services: MembershipPlanService[];
            planLocations: MembershipPlanLocation[];
          };
        return {
          ...planFields,
          serviceIds: (services ?? []).map((s) => s.serviceId),
          locationIds: (planLocations ?? []).map((pl) => pl.locationId),
        };
      })
    );
  } catch (error) {
    logError('memberships.listMembershipPlans', error, {
      feature: 'memberships',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to list membership plans'
      )
    );
  }
};

export const listMembershipPlans = (
  db: DbConnection,
  input: ListMembershipPlansInput
) =>
  trackedResult(
    'memberships.listMembershipPlans',
    () => withOrgScope((tx) => listMembershipPlansImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type ListMembershipPlansResult = Awaited<
  ReturnType<typeof listMembershipPlans>
>;
