import {
  type MembershipPlanService,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import type { MembershipPlanWithServices } from '../../models/index.js';
import {
  type GetMembershipPlanInput,
  getMembershipPlanSchema,
} from './get-membership-plan.schema.js';

/**
 * Fetch a single membership plan with the ids of the services it covers.
 */
const getMembershipPlanImpl = async (
  db: DbConnection,
  input: GetMembershipPlanInput
): Promise<Result<MembershipPlanWithServices>> => {
  const parsed = getMembershipPlanSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, planId } = parsed.data;

  try {
    const plan = await db.query.membershipPlan.findFirst({
      where: (t, { and, eq }) =>
        and(eq(t.id, planId), eq(t.organizationId, organizationId)),
      with: { services: true },
    });

    if (!plan) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Membership plan not found')
      );
    }

    const { services, ...planFields } = plan as typeof plan & {
      services: MembershipPlanService[];
    };

    return ok({
      ...planFields,
      serviceIds: (services ?? []).map((s) => s.serviceId),
    });
  } catch (error) {
    logError('memberships.getMembershipPlan', error, {
      feature: 'memberships',
      extra: { organizationId, planId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to fetch membership plan'
      )
    );
  }
};

export const getMembershipPlan = (
  db: DbConnection,
  input: GetMembershipPlanInput
) =>
  trackedResult(
    'memberships.getMembershipPlan',
    () => withOrgScope((tx) => getMembershipPlanImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        planId: input.planId,
      },
      internalErrorsOnly: true,
    }
  );

export type GetMembershipPlanResult = Awaited<
  ReturnType<typeof getMembershipPlan>
>;
