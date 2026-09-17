import { leadMembership, withOrgScope } from '@borradh-workspace/database';
import { getStripeConnectService } from '@borradh-workspace/integrations/stripe';
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
import type { LeadMembership } from '../../models/index.js';
import {
  type CancelLeadMembershipInput,
  cancelLeadMembershipSchema,
} from './cancel-lead-membership.schema.js';

/**
 * Cancel a lead membership. Recurring memberships also cancel the backing
 * Stripe subscription on the org's connected account (immediately).
 */
const cancelLeadMembershipImpl = async (
  db: DbConnection,
  input: CancelLeadMembershipInput
): Promise<Result<LeadMembership>> => {
  const parsed = cancelLeadMembershipSchema.safeParse(input);
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

    if (membership.status === 'cancelled') {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'Membership is already cancelled'
        )
      );
    }

    if (membership.stripeSubscriptionId) {
      const integration = await db.query.stripeConnectIntegration.findFirst({
        where: (t, { eq: eqOp }) => eqOp(t.organizationId, organizationId),
      });

      if (integration) {
        const stripeConnect = getStripeConnectService();
        try {
          await stripeConnect.cancelConnectedSubscription(
            integration.stripeAccountId,
            membership.stripeSubscriptionId
          );
        } catch (stripeError) {
          // A subscription that is already cancelled on Stripe's side must
          // not block the local cancel — log and continue.
          logError('memberships.cancelLeadMembership.stripe', stripeError, {
            feature: 'memberships',
            extra: {
              organizationId,
              leadMembershipId,
              stripeSubscriptionId: membership.stripeSubscriptionId,
            },
          });
        }
      }
    }

    const [updated] = await db
      .update(leadMembership)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(
        and(
          eq(leadMembership.id, leadMembershipId),
          eq(leadMembership.organizationId, organizationId)
        )
      )
      .returning();

    return ok(updated);
  } catch (error) {
    logError('memberships.cancelLeadMembership', error, {
      feature: 'memberships',
      extra: { organizationId, leadMembershipId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to cancel membership')
    );
  }
};

export const cancelLeadMembership = (
  db: DbConnection,
  input: CancelLeadMembershipInput
) =>
  trackedResult(
    'memberships.cancelLeadMembership',
    () => withOrgScope((tx) => cancelLeadMembershipImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        leadMembershipId: input.leadMembershipId,
      },
    }
  );

export type CancelLeadMembershipResult = Awaited<
  ReturnType<typeof cancelLeadMembership>
>;
