import {
  creditBalances,
  creditTransactions,
  invoices,
  isTransientDbError,
  subscriptions,
} from '@borradh-workspace/database';
import { getStripeService } from '@borradh-workspace/integrations/stripe';
import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import type Stripe from 'stripe';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  claimWebhookEvent,
  releaseWebhookEvent,
} from '../../../webhooks/index.js';
import { BillingErrorCodes } from '../../models/billing-error.types.js';
import { activateSubscription } from '../../shared/activate-subscription.js';
import {
  type HandleStripeWebhookInput,
  handleStripeWebhookSchema,
} from './handle-stripe-webhook.schema.js';

const logger = createLogger('billing.webhook');

/** Ledger provider key for customer-billing (platform-account) Stripe events. */
const WEBHOOK_PROVIDER = 'stripe_billing' as const;

interface WebhookResult {
  handled: boolean;
  eventType: string;
  eventId: string;
  /** True when this event was already applied and its effects were skipped. */
  duplicate?: boolean;
}

/**
 * Handle checkout.session.completed event
 */
async function handleCheckoutCompleted(
  db: DbConnection,
  session: Stripe.Checkout.Session
): Promise<void> {
  const organizationId = session.metadata?.organizationId;
  const type = session.metadata?.type;

  if (!organizationId) {
    logger.warn('No organizationId in checkout session metadata');
    return;
  }

  if (type === 'subscription') {
    // Subscription checkout completed
    const customerId =
      typeof session.customer === 'string'
        ? session.customer
        : session.customer?.id;
    const subscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id;

    if (!customerId || !subscriptionId) {
      logger.warn('Missing customer or subscription ID in session');
      return;
    }

    // One shared activation for both entry points — Checkout here, and an
    // operator seeding a subscription sold over the phone. See
    // activate-subscription.ts for why this must not be re-derived per path.
    await activateSubscription(db, {
      organizationId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      status: 'active',
    });

    logger.info('Subscription created', { organizationId, subscriptionId });
  } else if (type === 'credits') {
    // Credit purchase completed
    const creditsStr = session.metadata?.credits;
    const credits = creditsStr ? Number.parseInt(creditsStr, 10) : 0;

    if (credits > 0) {
      const balance = await db.query.creditBalances.findFirst({
        where: eq(creditBalances.organizationId, organizationId),
      });

      if (balance) {
        const newBalance = balance.balance + credits;

        await db
          .update(creditBalances)
          .set({ balance: newBalance })
          .where(eq(creditBalances.organizationId, organizationId));

        await db.insert(creditTransactions).values({
          id: crypto.randomUUID(),
          organizationId,
          type: 'purchase',
          amount: credits,
          balanceAfter: newBalance,
          referenceId: session.id,
          referenceType: 'stripe_checkout',
          description: `Purchased ${credits / 100} credits`,
        });

        logger.info('Credits purchased', { organizationId, credits });
      }
    }
  }
}

/**
 * Build update data from a Stripe subscription object
 */
function buildSubscriptionUpdateData(subscription: Stripe.Subscription) {
  return {
    status: subscription.status as typeof subscriptions.$inferSelect.status,
    currentPeriodStart: subscription.current_period_start
      ? new Date(subscription.current_period_start * 1000)
      : null,
    currentPeriodEnd: subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000)
      : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    canceledAt: subscription.canceled_at
      ? new Date(subscription.canceled_at * 1000)
      : null,
    endedAt: subscription.ended_at
      ? new Date(subscription.ended_at * 1000)
      : null,
    trialStart: subscription.trial_start
      ? new Date(subscription.trial_start * 1000)
      : null,
    trialEnd: subscription.trial_end
      ? new Date(subscription.trial_end * 1000)
      : null,
  };
}

/**
 * Handle subscription updated event
 */
async function handleSubscriptionUpdated(
  db: DbConnection,
  subscription: Stripe.Subscription
): Promise<void> {
  const organizationId = subscription.metadata?.organizationId;

  if (!organizationId) {
    // Try to find by subscription ID
    const existing = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.stripeSubscriptionId, subscription.id),
    });

    if (!existing) {
      logger.warn('Cannot find subscription to update', {
        subscriptionId: subscription.id,
      });
      return;
    }

    const updateData = buildSubscriptionUpdateData(subscription);

    await db
      .update(subscriptions)
      .set(updateData)
      .where(eq(subscriptions.stripeSubscriptionId, subscription.id));
  } else {
    const updateData = buildSubscriptionUpdateData(subscription);

    await db
      .update(subscriptions)
      .set(updateData)
      .where(eq(subscriptions.organizationId, organizationId));
  }

  logger.info('Subscription updated', {
    subscriptionId: subscription.id,
    status: subscription.status,
  });
}

/**
 * Handle invoice events
 */
async function handleInvoiceEvent(
  db: DbConnection,
  invoice: Stripe.Invoice,
  eventType: string
): Promise<void> {
  const customerId =
    typeof invoice.customer === 'string'
      ? invoice.customer
      : invoice.customer?.id;

  if (!customerId) return;

  // Find organization by customer ID
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeCustomerId, customerId),
  });

  if (!subscription) {
    logger.warn('Cannot find subscription for invoice', {
      invoiceId: invoice.id,
      customerId,
    });
    return;
  }

  // Upsert invoice record
  const existing = await db.query.invoices.findFirst({
    where: eq(invoices.stripeInvoiceId, invoice.id),
  });

  const invoiceData = {
    stripeInvoiceId: invoice.id,
    stripeCustomerId: customerId,
    organizationId: subscription.organizationId,
    subscriptionId: subscription.id,
    status: invoice.status as typeof invoices.$inferSelect.status,
    amountDue: invoice.amount_due,
    amountPaid: invoice.amount_paid,
    currency: invoice.currency,
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    invoicePdf: invoice.invoice_pdf ?? null,
    periodStart: invoice.period_start
      ? new Date(invoice.period_start * 1000)
      : null,
    periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : null,
    dueDate: invoice.due_date ? new Date(invoice.due_date * 1000) : null,
    paidAt: invoice.status_transitions?.paid_at
      ? new Date(invoice.status_transitions.paid_at * 1000)
      : null,
  };

  if (existing) {
    await db
      .update(invoices)
      .set(invoiceData)
      .where(eq(invoices.stripeInvoiceId, invoice.id));
  } else {
    await db.insert(invoices).values({
      id: crypto.randomUUID(),
      ...invoiceData,
    });
  }

  // Handle subscription renewal (invoice.paid for subscription)
  if (
    eventType === 'invoice.paid' &&
    invoice.billing_reason === 'subscription_cycle'
  ) {
    const balance = await db.query.creditBalances.findFirst({
      where: eq(creditBalances.organizationId, subscription.organizationId),
    });

    if (balance) {
      const refillAmount = balance.includedCredits;
      const newBalance = balance.balance + refillAmount;

      await db
        .update(creditBalances)
        .set({
          balance: newBalance,
          lastRefillAt: new Date(),
          lowBalanceAlertSent: false,
        })
        .where(eq(creditBalances.organizationId, subscription.organizationId));

      await db.insert(creditTransactions).values({
        id: crypto.randomUUID(),
        organizationId: subscription.organizationId,
        type: 'subscription_refill',
        amount: refillAmount,
        balanceAfter: newBalance,
        referenceId: invoice.id,
        referenceType: 'stripe_invoice',
        description: 'Monthly subscription credit refill',
      });

      logger.info('Credits refilled', {
        organizationId: subscription.organizationId,
        amount: refillAmount,
      });
    }
  }
}

/**
 * Handle charge.refunded event
 */
async function handleChargeRefunded(
  db: DbConnection,
  charge: Stripe.Charge
): Promise<void> {
  const customerId =
    typeof charge.customer === 'string' ? charge.customer : charge.customer?.id;

  if (!customerId) {
    logger.warn('No customer ID on refunded charge', { chargeId: charge.id });
    return;
  }

  // Find organization by customer ID
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeCustomerId, customerId),
  });

  if (!subscription) {
    logger.warn('Cannot find subscription for refunded charge', {
      chargeId: charge.id,
      customerId,
    });
    return;
  }

  // Find credit balance
  const balance = await db.query.creditBalances.findFirst({
    where: eq(creditBalances.organizationId, subscription.organizationId),
  });

  if (!balance) {
    logger.warn('No credit balance found for refund', {
      chargeId: charge.id,
      organizationId: subscription.organizationId,
    });
    return;
  }

  // `charge.amount_refunded` is CUMULATIVE across every partial refund on this
  // charge, and Stripe fires a fresh `charge.refunded` event for each one. Only
  // credit the DELTA since the last one, or a second partial refund would
  // re-credit the full running total. Prior refund credits for this charge are
  // the `refund` transactions already recorded against it.
  const priorRefundTxns =
    (await db.query.creditTransactions.findMany({
      where: and(
        eq(creditTransactions.referenceId, charge.id),
        eq(creditTransactions.referenceType, 'stripe_charge'),
        eq(creditTransactions.type, 'refund')
      ),
      columns: { amount: true },
    })) ?? [];
  const alreadyCredited = priorRefundTxns.reduce((sum, t) => sum + t.amount, 0);
  const refundAmount = charge.amount_refunded - alreadyCredited;

  if (refundAmount <= 0) {
    logger.info('Charge refund already fully credited — nothing to add', {
      organizationId: subscription.organizationId,
      chargeId: charge.id,
      cumulativeRefunded: charge.amount_refunded,
      alreadyCredited,
    });
    return;
  }

  const newBalance = balance.balance + refundAmount;

  await db
    .update(creditBalances)
    .set({ balance: newBalance })
    .where(eq(creditBalances.organizationId, subscription.organizationId));

  await db.insert(creditTransactions).values({
    id: crypto.randomUUID(),
    organizationId: subscription.organizationId,
    type: 'refund',
    amount: refundAmount,
    balanceAfter: newBalance,
    referenceId: charge.id,
    referenceType: 'stripe_charge',
    description: `Refund of ${refundAmount / 100} credits`,
  });

  logger.info('Charge refund processed', {
    organizationId: subscription.organizationId,
    chargeId: charge.id,
    refundAmount,
  });
}

/**
 * Internal implementation
 */
const handleStripeWebhookImpl = async (
  db: DbConnection,
  input: HandleStripeWebhookInput
): Promise<Result<WebhookResult>> => {
  const parsed = handleStripeWebhookSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { payload, signature } = parsed.data;

  try {
    const stripe = getStripeService();
    const event = stripe.constructWebhookEvent(payload, signature);

    logger.info('Processing webhook', { type: event.type, id: event.id });

    // Idempotency gate — Stripe delivers at-least-once and retries on any
    // non-2xx, so an event can arrive multiple times. Claim it BEFORE any
    // credit-granting effect runs; a replay finds the row already present and
    // no-ops instead of re-granting money.
    const claimed = await claimWebhookEvent(db, WEBHOOK_PROVIDER, event.id);
    if (!claimed) {
      logger.info(
        'Duplicate webhook event — effects already applied, skipping',
        {
          type: event.type,
          id: event.id,
        }
      );
      return ok({
        handled: true,
        eventType: event.type,
        eventId: event.id,
        duplicate: true,
      });
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutCompleted(
            db,
            event.data.object as Stripe.Checkout.Session
          );
          break;

        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
          await handleSubscriptionUpdated(
            db,
            event.data.object as Stripe.Subscription
          );
          break;

        case 'invoice.created':
        case 'invoice.paid':
        case 'invoice.payment_failed':
          await handleInvoiceEvent(
            db,
            event.data.object as Stripe.Invoice,
            event.type
          );
          break;

        case 'charge.refunded':
          await handleChargeRefunded(db, event.data.object as Stripe.Charge);
          break;

        default:
          logger.debug('Unhandled event type', { type: event.type });
      }
    } catch (effectError) {
      // Effects failed after we claimed the event — release the claim so
      // Stripe's retry can re-apply it, then rethrow into the outer handler.
      await releaseWebhookEvent(db, WEBHOOK_PROVIDER, event.id);
      throw effectError;
    }

    return ok({
      handled: true,
      eventType: event.type,
      eventId: event.id,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('No signatures found')
    ) {
      return err(
        new FeatureError(
          BillingErrorCodes.INVALID_WEBHOOK_SIGNATURE,
          'Invalid webhook signature'
        )
      );
    }

    logError('billing.handleStripeWebhook', error, { feature: 'billing' });

    // Classify: a transient DB/connection blip is RETRYABLE — the event is
    // valid and Stripe should redeliver (5xx at the controller). Anything else
    // is treated as a poison event that retrying won't fix, and is acknowledged
    // (2xx) so Stripe stops hammering it.
    if (isTransientDbError(error)) {
      return err(
        new FeatureError(
          BillingErrorCodes.WEBHOOK_TRANSIENT_ERROR,
          'Transient failure processing webhook'
        )
      );
    }

    return err(
      new FeatureError(
        BillingErrorCodes.STRIPE_WEBHOOK_ERROR,
        'Failed to process webhook'
      )
    );
  }
};

/**
 * Handle Stripe webhook events
 */
export const handleStripeWebhook = (
  db: DbConnection,
  input: HandleStripeWebhookInput
) =>
  trackedResult(
    'billing.handleStripeWebhook',
    () => handleStripeWebhookImpl(db, input),
    {
      properties: { hasSignature: !!input.signature },
    }
  );

export type HandleStripeWebhookResult = Awaited<
  ReturnType<typeof handleStripeWebhook>
>;
