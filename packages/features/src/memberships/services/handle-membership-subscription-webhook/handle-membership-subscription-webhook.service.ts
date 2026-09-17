import { leadMembership } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type LeadMembershipStatus,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type HandleMembershipSubscriptionWebhookInput,
  handleMembershipSubscriptionWebhookSchema,
} from './handle-membership-subscription-webhook.schema.js';

export interface MembershipSubscriptionWebhookResponse {
  processed: boolean;
  leadMembershipId: string | null;
  action: 'updated' | 'ignored';
}

/** Map a Stripe subscription status onto lead_membership.status. */
const mapStripeStatus = (
  eventType: HandleMembershipSubscriptionWebhookInput['eventType'],
  stripeStatus: string
): LeadMembershipStatus | null => {
  if (eventType === 'customer.subscription.deleted') return 'cancelled';
  switch (stripeStatus) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
      return 'cancelled';
    case 'incomplete_expired':
      return 'expired';
    default:
      return null; // incomplete / paused — leave the local status alone
  }
};

/**
 * Sync a Stripe subscription lifecycle event onto the matching
 * lead_membership row (status + validUntil ← current_period_end).
 *
 * NOTE: called from the Stripe Connect webhook controller under
 * `withSystemScope` — webhooks have no org context, so no `withOrgScope`
 * wrapper here (mirrors `handlePaymentWebhook`).
 */
const handleMembershipSubscriptionWebhookImpl = async (
  db: DbConnection,
  input: HandleMembershipSubscriptionWebhookInput
): Promise<Result<MembershipSubscriptionWebhookResponse>> => {
  const parsed = handleMembershipSubscriptionWebhookSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { eventType, stripeSubscriptionId, stripeStatus, currentPeriodEnd } =
    parsed.data;

  try {
    const membership = await db.query.leadMembership.findFirst({
      where: (t, { eq: eqOp }) =>
        eqOp(t.stripeSubscriptionId, stripeSubscriptionId),
    });

    if (!membership) {
      // Subscription not tracked by us (e.g. created directly in Stripe).
      return ok({
        processed: false,
        leadMembershipId: null,
        action: 'ignored',
      });
    }

    const mappedStatus = mapStripeStatus(eventType, stripeStatus);

    const values: Partial<typeof leadMembership.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (mappedStatus !== null) values.status = mappedStatus;
    if (currentPeriodEnd != null) values.validUntil = currentPeriodEnd;

    if (mappedStatus === null && currentPeriodEnd == null) {
      return ok({
        processed: false,
        leadMembershipId: membership.id,
        action: 'ignored',
      });
    }

    await db
      .update(leadMembership)
      .set(values)
      .where(eq(leadMembership.id, membership.id));

    return ok({
      processed: true,
      leadMembershipId: membership.id,
      action: 'updated',
    });
  } catch (error) {
    logError('memberships.handleMembershipSubscriptionWebhook', error, {
      feature: 'memberships',
      extra: { stripeSubscriptionId, eventType, stripeStatus },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to process subscription webhook'
      )
    );
  }
};

export const handleMembershipSubscriptionWebhook = (
  db: DbConnection,
  input: HandleMembershipSubscriptionWebhookInput
) =>
  trackedResult(
    'memberships.handleMembershipSubscriptionWebhook',
    () => handleMembershipSubscriptionWebhookImpl(db, input),
    {
      properties: {
        eventType: input.eventType,
        stripeSubscriptionId: input.stripeSubscriptionId,
      },
    }
  );

export type HandleMembershipSubscriptionWebhookResult = Awaited<
  ReturnType<typeof handleMembershipSubscriptionWebhook>
>;
