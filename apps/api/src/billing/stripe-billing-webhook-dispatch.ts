import { db, withSystemScope } from '@borradh-workspace/database';
import {
  BillingErrorCodes,
  handleStripeWebhook,
} from '@borradh-workspace/features/billing';
import { HttpException, HttpStatus, type Logger } from '@nestjs/common';

/**
 * The Stripe customer-billing webhook orchestration, shared verbatim by the two
 * routes that expose it:
 *
 *   - `POST /billing/webhook`   (legacy direct endpoint, unscoped `db`)
 *   - `POST /webhooks/billing`  (borradh-webhooks router fan-out, system-scoped)
 *
 * The two differed ONLY in how they reach the database, so that is the one
 * parameter — `execute`. Everything else, in particular the ack semantics
 * below, is now one implementation instead of two copies that could drift.
 *
 * ACK SEMANTICS (Stripe retries on any non-2xx — do not "simplify" these):
 *   INVALID_WEBHOOK_SIGNATURE -> 400, reject the forgery.
 *   WEBHOOK_TRANSIENT_ERROR   -> 500, so Stripe redelivers the still-valid event.
 *   anything else             -> 200 `{ received: true, acknowledged: false }`,
 *                                a poison event redelivery will not fix. The
 *                                failure is already logged in the service and
 *                                the idempotency claim was released, so it can
 *                                be replayed manually after a fix.
 */

export interface StripeWebhookPayload {
  payload: string;
  signature: string;
}

export type StripeWebhookExecutor = (
  input: StripeWebhookPayload
) => ReturnType<typeof handleStripeWebhook>;

/** `POST /billing/webhook` — unscoped connection, as it has always run. */
export const runStripeBillingWebhook: StripeWebhookExecutor = (input) =>
  handleStripeWebhook(db, input);

/** `POST /webhooks/billing` — system-scoped connection (RLS bypass). */
export const runStripeBillingWebhookSystemScoped: StripeWebhookExecutor = (
  input
) => withSystemScope((conn) => handleStripeWebhook(conn, input), { db });

export async function dispatchStripeBillingWebhook(input: {
  rawBody: Buffer | undefined;
  signature: string;
  logger: Logger;
  execute: StripeWebhookExecutor;
}): Promise<{ received: true; acknowledged?: false }> {
  const { rawBody, signature, logger, execute } = input;

  if (!rawBody) {
    throw new HttpException('No raw body', HttpStatus.BAD_REQUEST);
  }

  const result = await execute({ payload: rawBody.toString(), signature });

  if (!result.success) {
    logger.warn(`Webhook handling failed: ${result.error.code}`);

    if (result.error.code === BillingErrorCodes.INVALID_WEBHOOK_SIGNATURE) {
      throw new HttpException('Invalid signature', HttpStatus.BAD_REQUEST);
    }

    if (result.error.code === BillingErrorCodes.WEBHOOK_TRANSIENT_ERROR) {
      throw new HttpException(
        'Webhook processing failed — retry',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    logger.error(
      `Acknowledging non-retryable webhook failure to stop Stripe retries: ${result.error.code} — ${result.error.message}`
    );
    return { received: true, acknowledged: false };
  }

  logger.log(
    `Webhook processed: ${result.data.eventType} (${result.data.eventId})`
  );
  return { received: true };
}
