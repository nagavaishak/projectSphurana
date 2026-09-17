import { subscriptions } from '@borradh-workspace/database';
import { getStripeService } from '@borradh-workspace/integrations/stripe';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { activateSubscription } from '../../shared/activate-subscription.js';
import {
  type SeedSubscriptionInput,
  seedSubscriptionSchema,
} from './seed-subscription.schema.js';

export interface SeedSubscriptionResponse {
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  status: string;
  currentPeriodEnd: Date | null;
}

/**
 * Attach a subscription that already exists in Stripe to an organization.
 *
 * Customers sold over the phone don't pay through onboarding: the subscription
 * is created in Stripe during the sales call, and the workspace is built
 * afterwards. Without this, that org looks unsubscribed in the product — no
 * plan, no credit balance, gated features — until someone puts it through a
 * checkout it has already paid for.
 *
 * The state written is exactly what Checkout writes (`activateSubscription`),
 * so a seeded org and a self-serve org are indistinguishable downstream,
 * including the opening credit grant.
 */
const seedSubscriptionImpl = async (
  db: DbConnection,
  input: SeedSubscriptionInput
): Promise<Result<SeedSubscriptionResponse>> => {
  const parsed = seedSubscriptionSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, stripeRef } = parsed.data;
  const stripe = getStripeService();

  let subscription: Awaited<ReturnType<typeof stripe.getSubscription>>;
  try {
    subscription = stripeRef.startsWith('sub_')
      ? await stripe.getSubscription(stripeRef)
      : await stripe.getSubscriptionByCustomer(stripeRef);
  } catch (error) {
    logError('billing.seedSubscription.lookup', error, {
      feature: 'billing',
      extra: { organizationId, stripeRef },
    });
    return err(
      new FeatureError(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        'Could not reach Stripe to look that up. Please try again.'
      )
    );
  }

  if (!subscription) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        stripeRef.startsWith('sub_')
          ? 'No Stripe subscription with that ID. Check it in the Stripe dashboard.'
          : 'That Stripe customer has no subscription. Create the subscription first, then seed it here.'
      )
    );
  }

  // A subscription can only fund ONE workspace. The unique index on
  // stripe_subscription_id is the real enforcement, but reaching it means a
  // constraint error with a name buried on `error.cause` — a check here turns
  // the common case (the operator has the wrong org open) into a sentence that
  // says so.
  const claimedElsewhere = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeSubscriptionId, subscription.id),
  });
  if (claimedElsewhere && claimedElsewhere.organizationId !== organizationId) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'That Stripe subscription is already seeded on another organization.'
      )
    );
  }

  // Statuses that mean "this subscription is not currently paying for
  // anything". Seeding one would light the product up for an org whose card
  // was declined or whose plan was cancelled, and nothing downstream would
  // question it — the row would simply say active.
  const UNUSABLE = new Set(['canceled', 'incomplete_expired', 'unpaid']);
  if (UNUSABLE.has(subscription.status)) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        `That subscription is ${subscription.status} in Stripe, so it can't be attached to a workspace.`
      )
    );
  }

  try {
    await activateSubscription(db, {
      organizationId,
      stripeCustomerId: subscription.customerId,
      stripeSubscriptionId: subscription.id,
      status: subscription.status,
      stripePriceId: subscription.priceId,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      canceledAt: subscription.canceledAt,
    });
  } catch (error) {
    logError('billing.seedSubscription', error, {
      feature: 'billing',
      extra: { organizationId, stripeRef, subscriptionId: subscription.id },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to seed the subscription'
      )
    );
  }

  return ok({
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: subscription.customerId,
    status: subscription.status,
    currentPeriodEnd: subscription.currentPeriodEnd ?? null,
  });
};

/**
 * Attach an existing Stripe subscription (by subscription or customer id) to
 * an organization.
 */
export const seedSubscription = (
  db: DbConnection,
  input: SeedSubscriptionInput
) =>
  trackedResult(
    'billing.seedSubscription',
    () => seedSubscriptionImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type SeedSubscriptionResult = Awaited<
  ReturnType<typeof seedSubscription>
>;
