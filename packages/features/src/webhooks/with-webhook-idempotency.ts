import { processedWebhookEvent } from '@borradh-workspace/database';
import type { WebhookProvider } from '@borradh-workspace/integrations/webhooks';
import { createLogger, logError } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import type { DbConnection } from '../shared/index.js';

const logger = createLogger('webhooks.idempotency');

/**
 * The webhook idempotency ledger, in ONE place.
 *
 * `processed_webhook_event`'s own docblock names `stripe_connect` as a
 * provider — and until now the ONLY consumer of the table was billing. The
 * Stripe Connect controller handled `charge.refunded`,
 * `checkout.session.completed`, `payment_intent.succeeded` and the subscription
 * lifecycle, never touched the ledger, and `throw`ew on any handler error —
 * which makes Stripe redeliver an event whose effects may have PARTIALLY
 * applied. Money-moving effects (refund credits, membership state) were
 * therefore replay-unsafe.
 *
 * This wrapper lives in the ROUTER, not in a handler, so a new event type
 * cannot forget it.
 */

/**
 * Claim an event id. Race-safe via the (provider, event_id) primary key: a
 * concurrent duplicate delivery loses the insert race and gets zero rows.
 *
 * @returns `true` if THIS call claimed the event (apply the effects),
 *          `false` if it was already applied (skip).
 */
export const claimWebhookEvent = async (
  db: DbConnection,
  provider: WebhookProvider,
  eventId: string
): Promise<boolean> => {
  const inserted = await db
    .insert(processedWebhookEvent)
    .values({ provider, eventId })
    .onConflictDoNothing()
    .returning({ eventId: processedWebhookEvent.eventId });
  return inserted.length > 0;
};

/**
 * Release a claim so the provider's retry can re-apply the event. Called only
 * when effect application throws AFTER the claim — otherwise the marker would
 * permanently swallow a transient failure.
 */
export const releaseWebhookEvent = async (
  db: DbConnection,
  provider: WebhookProvider,
  eventId: string
): Promise<void> => {
  try {
    await db
      .delete(processedWebhookEvent)
      .where(
        and(
          eq(processedWebhookEvent.provider, provider),
          eq(processedWebhookEvent.eventId, eventId)
        )
      );
  } catch (error) {
    // Best-effort compensation. If the release itself fails, log loudly — the
    // worst case is a genuinely-transient event being skipped on retry.
    logError('webhooks.releaseWebhookEvent', error, {
      feature: 'webhooks',
      extra: { provider, eventId },
    });
  }
};

export type IdempotentOutcome<T> =
  | { duplicate: true; result: undefined }
  | { duplicate: false; result: T };

/**
 * Run `apply` exactly once per (provider, eventId), even under the provider's
 * at-least-once redelivery.
 *
 * - First delivery: claim wins → `apply` runs → `{ duplicate: false }`.
 * - Replay: claim loses → `apply` is SKIPPED → `{ duplicate: true }`.
 * - `apply` throws: the claim is released and the error rethrown, so the
 *   provider's retry can legitimately re-apply it.
 */
export const withWebhookIdempotency = async <T>(
  db: DbConnection,
  provider: WebhookProvider,
  eventId: string,
  apply: () => Promise<T>
): Promise<IdempotentOutcome<T>> => {
  const claimed = await claimWebhookEvent(db, provider, eventId);
  if (!claimed) {
    logger.info('Duplicate webhook event — effects already applied, skipping', {
      provider,
      eventId,
    });
    return { duplicate: true, result: undefined };
  }

  try {
    const result = await apply();
    return { duplicate: false, result };
  } catch (error) {
    await releaseWebhookEvent(db, provider, eventId);
    throw error;
  }
};
