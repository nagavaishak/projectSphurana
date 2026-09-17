import { membershipPlan, withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type DeleteMembershipPlanInput,
  deleteMembershipPlanSchema,
} from './delete-membership-plan.schema.js';

export interface DeleteMembershipPlanResponse {
  /** true = row removed; false = plan had sold memberships → deactivated. */
  deleted: boolean;
  deactivated: boolean;
}

/**
 * Delete a membership plan. Plans that have ever been sold (any
 * lead_membership rows — the FK is `restrict`) are soft-deleted by setting
 * `isActive=false` instead, per contract §3.8.
 */
const deleteMembershipPlanImpl = async (
  db: DbConnection,
  input: DeleteMembershipPlanInput
): Promise<Result<DeleteMembershipPlanResponse>> => {
  const parsed = deleteMembershipPlanSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, planId } = parsed.data;

  try {
    const existing = await db.query.membershipPlan.findFirst({
      where: (t, { and: andOp, eq: eqOp }) =>
        andOp(eqOp(t.id, planId), eqOp(t.organizationId, organizationId)),
    });

    if (!existing) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Membership plan not found')
      );
    }

    const sold = await db.query.leadMembership.findFirst({
      where: (t, { eq: eqOp }) => eqOp(t.planId, planId),
    });

    if (sold) {
      await db
        .update(membershipPlan)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            eq(membershipPlan.id, planId),
            eq(membershipPlan.organizationId, organizationId)
          )
        );
      return ok({ deleted: false, deactivated: true });
    }

    await db
      .delete(membershipPlan)
      .where(
        and(
          eq(membershipPlan.id, planId),
          eq(membershipPlan.organizationId, organizationId)
        )
      );

    return ok({ deleted: true, deactivated: false });
  } catch (error) {
    logError('memberships.deleteMembershipPlan', error, {
      feature: 'memberships',
      extra: { organizationId, planId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to delete membership plan'
      )
    );
  }
};

export const deleteMembershipPlan = (
  db: DbConnection,
  input: DeleteMembershipPlanInput
) =>
  trackedResult(
    'memberships.deleteMembershipPlan',
    () => withOrgScope((tx) => deleteMembershipPlanImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        planId: input.planId,
      },
    }
  );

export type DeleteMembershipPlanResult = Awaited<
  ReturnType<typeof deleteMembershipPlan>
>;
