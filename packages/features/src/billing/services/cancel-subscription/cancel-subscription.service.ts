import { subscriptions, withOrgScope } from '@borradh-workspace/database';
import { getStripeService } from '@borradh-workspace/integrations/stripe';
import type { SubscriptionInfo } from '@borradh-workspace/integrations/stripe';
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
import { BillingErrorCodes } from '../../models/billing-error.types.js';
import {
  type CancelSubscriptionInput,
  cancelSubscriptionSchema,
} from './cancel-subscription.schema.js';

const cancelSubscriptionImpl = async (
  db: DbConnection,
  input: CancelSubscriptionInput
): Promise<Result<SubscriptionInfo>> => {
  const parsed = cancelSubscriptionSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, immediate } = parsed.data;

  // Find existing subscription
  const subscription = await withOrgScope(
    (tx) =>
      tx.query.subscriptions.findFirst({
        where: eq(subscriptions.organizationId, organizationId),
      }),
    { db }
  );

  if (!subscription) {
    return err(
      new FeatureError(
        BillingErrorCodes.SUBSCRIPTION_NOT_FOUND,
        'Subscription not found'
      )
    );
  }

  if (!subscription.stripeSubscriptionId) {
    return err(
      new FeatureError(
        BillingErrorCodes.SUBSCRIPTION_NOT_FOUND,
        'No Stripe subscription ID found'
      )
    );
  }

  // Check if already canceled
  if (
    subscription.status === 'canceled' ||
    subscription.status === 'incomplete_expired'
  ) {
    return err(
      new FeatureError(
        BillingErrorCodes.SUBSCRIPTION_INACTIVE,
        'Subscription is already canceled'
      )
    );
  }

  try {
    const stripe = getStripeService();
    let result: SubscriptionInfo;

    if (immediate) {
      result = await stripe.cancelSubscriptionImmediately(
        subscription.stripeSubscriptionId
      );
    } else {
      result = await stripe.cancelSubscription(
        subscription.stripeSubscriptionId
      );
    }

    // Update local subscription record
    await withOrgScope(
      (tx) =>
        tx
          .update(subscriptions)
          .set({
            status: result.status,
            cancelAtPeriodEnd: result.cancelAtPeriodEnd,
            canceledAt: result.canceledAt,
            endedAt: result.endedAt,
          })
          .where(eq(subscriptions.organizationId, organizationId)),
      { db }
    );

    return ok(result);
  } catch (error) {
    logError('billing.cancelSubscription', error, {
      feature: 'billing',
      extra: { organizationId, immediate },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to cancel subscription'
      )
    );
  }
};

export const cancelSubscription = (
  db: DbConnection,
  input: CancelSubscriptionInput
) =>
  trackedResult(
    'billing.cancelSubscription',
    () => cancelSubscriptionImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        immediate: input.immediate,
      },
    }
  );

export type CancelSubscriptionResult = Awaited<
  ReturnType<typeof cancelSubscription>
>;
