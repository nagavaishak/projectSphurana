import { db, withSystemScope } from '@borradh-workspace/database';
import { handleDepositWebhook } from '@borradh-workspace/features/appointments';
import { syncStripeAccountStatus } from '@borradh-workspace/features/integrations';
import { handleMembershipSubscriptionWebhook } from '@borradh-workspace/features/memberships';
import { handlePaymentWebhook } from '@borradh-workspace/features/payments';
import {
  finalizeShopCheckout,
  handleSalePaymentWebhook,
} from '@borradh-workspace/features/sales';
import type {
  HandledTypeOf,
  stripeConnectEvents,
} from '@borradh-workspace/integrations/webhooks';
import type { Logger } from '@nestjs/common';
import type Stripe from 'stripe';

/**
 * Stripe Connect handlers, keyed by `Record<HandledTypeOf<…>, Handler>`.
 *
 * The key set is DERIVED from the webhook registry, so a declared-handled event
 * with no handler is a compile error and a handler for an undeclared event is a
 * compile error. The previous shape — a ~300-line if/else chain over
 * `event.type` × `metadata.type`, ending in
 * `return { received: true, processed: false, action: 'ignored' }` — could
 * silently swallow any event type the chain forgot.
 *
 * Idempotency is NOT here: it wraps the whole dispatch in the controller, so a
 * new handler cannot forget the ledger.
 */

export interface StripeConnectResult {
  processed: boolean;
  action: string;
}

export type StripeConnectHandler = (ctx: {
  event: Stripe.Event;
  logger: Logger;
}) => Promise<StripeConnectResult>;

/** A feature-level failure; the controller maps it to a status. */
export class StripeConnectHandlerError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'StripeConnectHandlerError';
  }
}

const unwrap = <T>(
  result:
    | { success: true; data: T }
    | { success: false; error: { code: string; message: string } }
): T => {
  if (!result.success) {
    throw new StripeConnectHandlerError(
      result.error.code,
      result.error.message
    );
  }
  return result.data;
};

type CheckoutEventType =
  | 'checkout.session.completed'
  | 'checkout.session.expired'
  | 'charge.refunded';

/**
 * Deposit fallback for a checkout-shaped event that carries no recognised
 * `metadata.type`.
 */
const handleDepositEvent = async (
  eventType: CheckoutEventType,
  session: Record<string, unknown>
): Promise<StripeConnectResult> => {
  const metadata = session.metadata as Record<string, string> | undefined;
  if (metadata?.type !== 'appointment_deposit') {
    return { processed: false, action: 'ignored' };
  }

  const data = unwrap(
    await withSystemScope(
      (conn) =>
        handleDepositWebhook(conn, {
          eventType,
          checkoutSessionId: session.id as string | undefined,
          paymentIntentId: session.payment_intent as string | undefined,
          metadata,
        }),
      { db }
    )
  );
  return { processed: data.processed, action: data.action ?? 'ignored' };
};

/**
 * checkout.session.* and the checkout-shaped part of charge.refunded, routed by
 * `metadata.type`: sale tender → payment → appointment deposit.
 */
const handleCheckoutShaped: StripeConnectHandler = async ({
  event,
  logger,
}) => {
  const eventType = event.type as CheckoutEventType;
  const session = event.data.object as unknown as Record<string, unknown>;
  const metadata = session.metadata as Record<string, string> | undefined;

  if (metadata?.type === 'shop_checkout') {
    // Only completion turns the short-lived reservation into a paid order.
    // An expired Checkout has no sale, so its hold simply times out.
    if (eventType === 'checkout.session.expired') {
      return { processed: true, action: 'shop_checkout_expired' };
    }
    if (!metadata.organizationId || !metadata.cartId) {
      return { processed: false, action: 'ignored' };
    }
    const customerDetails = session.customer_details as
      | { email?: string | null }
      | undefined;
    const data = unwrap(
      await withSystemScope(
        (conn) =>
          finalizeShopCheckout(conn, {
            organizationId: metadata.organizationId,
            cartId: metadata.cartId,
            checkoutSessionId: session.id as string,
            paymentIntentId:
              typeof session.payment_intent === 'string'
                ? session.payment_intent
                : undefined,
            customerEmail: customerDetails?.email ?? undefined,
            currency:
              typeof session.currency === 'string' ? session.currency : 'eur',
          }),
        { db }
      )
    );
    logger.log(
      `Shop checkout webhook processed: action=${data.action}, saleId=${data.saleId}`
    );
    return {
      processed: data.action === 'created',
      action: `shop_${data.action}`,
    };
  }

  if (metadata?.type === 'sale_payment') {
    const data = unwrap(
      await withSystemScope(
        (conn) =>
          handleSalePaymentWebhook(conn, {
            eventType,
            paymentIntentId:
              typeof session.payment_intent === 'string'
                ? session.payment_intent
                : undefined,
            metadata,
          }),
        { db }
      )
    );
    logger.log(
      `Sale payment webhook processed: action=${data.action}, salePaymentId=${data.salePaymentId}`
    );
    return { processed: data.processed, action: data.action };
  }

  if (metadata?.type === 'payment') {
    const data = unwrap(
      await withSystemScope(
        (conn) =>
          handlePaymentWebhook(conn, {
            eventType,
            checkoutSessionId: session.id as string | undefined,
            paymentIntentId: session.payment_intent as string | undefined,
            metadata,
          }),
        { db }
      )
    );
    logger.log(
      `Payment webhook processed: action=${data.action}, paymentId=${data.paymentId}`
    );
    // `action` is optional on the payments result; the wire contract is a string.
    return { processed: data.processed, action: data.action ?? 'ignored' };
  }

  const result = await handleDepositEvent(eventType, session);
  logger.log(`Deposit webhook processed: action=${result.action}`);
  return result;
};

/**
 * A Charge's `metadata` is NOT the PaymentIntent / Payment Link metadata, so a
 * refund cannot be routed by `metadata.type`. Resolve the sale tender by the
 * charge's `payment_intent` first; if none matches, fall through to the
 * checkout-shaped payment/deposit routing (unchanged legacy behaviour).
 */
const handleChargeRefunded: StripeConnectHandler = async (ctx) => {
  const charge = ctx.event.data.object as Stripe.Charge;
  const chargePaymentIntentId =
    typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : undefined;

  if (chargePaymentIntentId) {
    const data = unwrap(
      await withSystemScope(
        (conn) =>
          handleSalePaymentWebhook(conn, {
            eventType: 'charge.refunded',
            paymentIntentId: chargePaymentIntentId,
            metadata: charge.metadata as Record<string, string> | undefined,
            amountRefundedCents: charge.amount_refunded,
            amountCapturedCents: charge.amount_captured ?? charge.amount,
          }),
        { db }
      )
    );

    // A matched sale tender carries a salePaymentId — this refund belonged to a
    // sale, so we're done.
    if (data.salePaymentId) {
      ctx.logger.log(
        `Sale refund processed: action=${data.action}, salePaymentId=${data.salePaymentId}`
      );
      return { processed: data.processed, action: data.action };
    }
  }

  return handleCheckoutShaped(ctx);
};

/**
 * Card-terminal / Tap to Pay PaymentIntents settle asynchronously via the
 * reader, so there is no checkout.session — the Terminal PaymentIntent carries
 * our `sale_payment` metadata directly.
 */
const handlePaymentIntent: StripeConnectHandler = async ({ event, logger }) => {
  const paymentIntent = event.data.object as unknown as Record<string, unknown>;
  const metadata = paymentIntent.metadata as Record<string, string> | undefined;

  if (metadata?.type !== 'sale_payment') {
    // A PaymentIntent that isn't one of our sale tenders (e.g. a
    // checkout-session PI already handled via checkout.session.completed).
    logger.log(
      `Ignoring payment_intent without sale_payment metadata: ${event.type}`
    );
    return { processed: false, action: 'ignored' };
  }

  const data = unwrap(
    await withSystemScope(
      (conn) =>
        handleSalePaymentWebhook(conn, {
          eventType: event.type as
            | 'payment_intent.succeeded'
            | 'payment_intent.payment_failed',
          paymentIntentId:
            typeof paymentIntent.id === 'string' ? paymentIntent.id : undefined,
          metadata,
        }),
      { db }
    )
  );
  logger.log(
    `Sale payment intent processed: action=${data.action}, salePaymentId=${data.salePaymentId}`
  );
  return { processed: data.processed, action: data.action };
};

const handleAccountUpdated: StripeConnectHandler = async ({
  event,
  logger,
}) => {
  const account = event.data.object as Stripe.Account;

  const data = unwrap(
    await withSystemScope(
      (conn) =>
        syncStripeAccountStatus(conn, {
          stripeAccountId: account.id,
          chargesEnabled: account.charges_enabled ?? false,
          payoutsEnabled: account.payouts_enabled ?? false,
          detailsSubmitted: account.details_submitted ?? false,
          email: account.email ?? null,
          businessName: account.business_profile?.name ?? null,
          defaultCurrency: account.default_currency ?? null,
          requirementsCurrentlyDue: account.requirements?.currently_due ?? null,
          disabledReason: account.requirements?.disabled_reason ?? null,
        }),
      { db }
    )
  );

  const synced = data !== null;
  logger.log(
    `Account ${account.id} status synced: ${synced ? 'updated' : 'not tracked'}`
  );
  return { processed: synced, action: synced ? 'account_synced' : 'ignored' };
};

const handleSubscriptionLifecycle: StripeConnectHandler = async ({
  event,
  logger,
}) => {
  const subscription = event.data.object as Stripe.Subscription;

  const data = unwrap(
    await withSystemScope(
      (conn) =>
        handleMembershipSubscriptionWebhook(conn, {
          eventType: event.type as
            | 'customer.subscription.updated'
            | 'customer.subscription.deleted',
          stripeSubscriptionId: subscription.id,
          stripeStatus: subscription.status,
          currentPeriodEnd: subscription.current_period_end
            ? new Date(subscription.current_period_end * 1000)
            : null,
        }),
      { db }
    )
  );

  logger.log(
    `Membership subscription webhook processed: action=${data.action}, leadMembershipId=${data.leadMembershipId}`
  );
  return { processed: data.processed, action: data.action };
};

export const stripeConnectHandlers: Record<
  HandledTypeOf<(typeof stripeConnectEvents)[number]>,
  StripeConnectHandler
> = {
  'checkout.session.completed': handleCheckoutShaped,
  'checkout.session.expired': handleCheckoutShaped,
  'charge.refunded': handleChargeRefunded,
  'payment_intent.succeeded': handlePaymentIntent,
  'payment_intent.payment_failed': handlePaymentIntent,
  'account.updated': handleAccountUpdated,
  'customer.subscription.updated': handleSubscriptionLifecycle,
  'customer.subscription.deleted': handleSubscriptionLifecycle,
};
