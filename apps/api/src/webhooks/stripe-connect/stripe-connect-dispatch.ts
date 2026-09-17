import { db } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import { withWebhookIdempotency } from '@borradh-workspace/features/webhooks';
import { getStripeConnectService } from '@borradh-workspace/integrations/stripe';
import { dispositionOf } from '@borradh-workspace/integrations/webhooks';
import { logError } from '@borradh-workspace/observability';
import { HttpException, HttpStatus, type Logger } from '@nestjs/common';
import type Stripe from 'stripe';
import { webhookHttpError } from '../webhook-http-error.js';
import {
  StripeConnectHandlerError,
  stripeConnectHandlers,
} from './stripe-connect-handlers.js';

export interface StripeConnectAck {
  received: true;
  processed: boolean;
  action: string;
}

/**
 * Stripe Connect webhook orchestration.
 *
 * Routing is DERIVED from the webhook registry (`stripeConnectEvents`), and
 * every effect runs inside `withWebhookIdempotency` — Stripe delivers
 * at-least-once and retries on any non-2xx, so an event whose handler threw
 * halfway must not re-apply its completed half on redelivery (refund credits,
 * membership state). The claim is released on throw and re-taken on retry.
 *
 * Signature verification stays here rather than in a guard because it is also
 * the PARSER: `constructConnectWebhookEvent` returns the typed `Stripe.Event`
 * that dispatch keys off, and a guard cannot hand that to the handler without
 * smuggling it onto the request.
 *
 * @see https://stripe.com/docs/connect/webhooks
 */
export async function dispatchStripeConnectWebhook(input: {
  rawBody: Buffer | undefined;
  signature: string;
  logger: Logger;
}): Promise<StripeConnectAck> {
  const { rawBody, signature, logger } = input;

  if (!rawBody) {
    logger.warn('Empty webhook payload received');
    throw new HttpException('Empty payload', HttpStatus.BAD_REQUEST);
  }

  const webhookSecret = apiEnv.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logError(
      'stripe.webhookConfig',
      new Error('STRIPE_CONNECT_WEBHOOK_SECRET not configured'),
      { feature: 'webhooks' }
    );
    throw new HttpException(
      'Webhook not configured',
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }

  const stripeConnect = getStripeConnectService();
  let event: Stripe.Event;
  try {
    event = stripeConnect.constructConnectWebhookEvent(
      rawBody,
      signature,
      webhookSecret
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.warn(`Webhook signature verification failed: ${message}`);
    throw new HttpException(
      `Webhook Error: ${message}`,
      HttpStatus.BAD_REQUEST
    );
  }

  logger.log(`Processing Stripe event: ${event.type}`);

  const disposition = dispositionOf('stripe_connect', event.type);

  if (disposition.kind === 'ignored') {
    logger.log(
      `Dropping stripe_connect.${event.type} — declared ignoredBecause: ${disposition.because}`
    );
    return { received: true, processed: false, action: 'ignored' };
  }

  if (disposition.kind === 'undeclared') {
    // Stripe is sending us an event type nothing in the code knows about —
    // i.e. the dashboard's event selection has drifted from the registry.
    // Loud, not a silent 200-and-drop.
    logError(
      'stripe.webhook.undeclaredEvent',
      new Error(
        `Stripe delivered an undeclared event type "${event.type}". Add it to the webhook registry with a handler or an ignoredBecause reason, or deselect it in the Stripe dashboard.`
      ),
      {
        feature: 'webhooks',
        extra: { eventType: event.type, eventId: event.id },
      }
    );
    return { received: true, processed: false, action: 'undeclared' };
  }

  const handler =
    stripeConnectHandlers[event.type as keyof typeof stripeConnectHandlers];
  if (!handler) {
    // Unreachable: the handler map is exhaustive over the registry's handled
    // types (compile-checked), and the disposition above is `handled`.
    logError(
      'stripe.webhook.handlerMismatch',
      new Error(`No handler bound for stripe_connect.${event.type}`),
      { feature: 'webhooks', extra: { eventType: event.type } }
    );
    return { received: true, processed: false, action: 'unhandled' };
  }

  try {
    // The ledger lives in the ROUTER, not the handler.
    const outcome = await withWebhookIdempotency(
      db,
      'stripe_connect',
      event.id,
      () => handler({ event, logger })
    );

    if (outcome.duplicate) {
      return { received: true, processed: false, action: 'duplicate' };
    }

    return {
      received: true,
      processed: outcome.result.processed,
      action: outcome.result.action,
    };
  } catch (error) {
    if (error instanceof StripeConnectHandlerError) {
      throw webhookHttpError(error);
    }
    throw error;
  }
}
