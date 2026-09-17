import { leadMembership, withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, gt, sql } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import type { LeadMembership } from '../../models/index.js';
import {
  type RedeemMembershipSessionInput,
  redeemMembershipSessionSchema,
} from './redeem-membership-session.schema.js';

/**
 * Redeem one session from a lead membership.
 *
 * Guards: membership must be `active` and not past `validUntil` (an expired
 * membership is flipped to `expired` on the way out). Unlimited memberships
 * (`sessionsRemaining` NULL) redeem without decrementing. Limited memberships
 * decrement atomically (`WHERE sessions_remaining > 0`) so concurrent
 * redemptions can never take the balance below zero.
 */
const redeemMembershipSessionImpl = async (
  db: DbConnection,
  input: RedeemMembershipSessionInput
): Promise<Result<LeadMembership>> => {
  const parsed = redeemMembershipSessionSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, leadMembershipId } = parsed.data;

  try {
    const membership = await db.query.leadMembership.findFirst({
      where: (t, { and: andOp, eq: eqOp }) =>
        andOp(
          eqOp(t.id, leadMembershipId),
          eqOp(t.organizationId, organizationId)
        ),
    });

    if (!membership) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Membership not found')
      );
    }

    if (membership.status !== 'active') {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          `Membership is ${membership.status}, not active`
        )
      );
    }

    if (membership.validUntil && membership.validUntil < new Date()) {
      await db
        .update(leadMembership)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(
          and(
            eq(leadMembership.id, leadMembershipId),
            eq(leadMembership.organizationId, organizationId)
          )
        );
      return err(
        new FeatureError(ErrorCodes.INVALID_STATE, 'Membership has expired')
      );
    }

    // Unlimited membership — nothing to decrement.
    if (membership.sessionsRemaining === null) {
      return ok(membership);
    }

    const [updated] = await db
      .update(leadMembership)
      .set({
        sessionsRemaining: sql`${leadMembership.sessionsRemaining} - 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(leadMembership.id, leadMembershipId),
          eq(leadMembership.organizationId, organizationId),
          gt(leadMembership.sessionsRemaining, 0)
        )
      )
      .returning();

    if (!updated) {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'No sessions remaining on this membership'
        )
      );
    }

    return ok(updated);
  } catch (error) {
    logError('memberships.redeemMembershipSession', error, {
      feature: 'memberships',
      extra: { organizationId, leadMembershipId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to redeem membership session'
      )
    );
  }
};

export const redeemMembershipSession = (
  db: DbConnection,
  input: RedeemMembershipSessionInput
) =>
  trackedResult(
    'memberships.redeemMembershipSession',
    () => withOrgScope((tx) => redeemMembershipSessionImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        leadMembershipId: input.leadMembershipId,
      },
    }
  );

export type RedeemMembershipSessionResult = Awaited<
  ReturnType<typeof redeemMembershipSession>
>;
