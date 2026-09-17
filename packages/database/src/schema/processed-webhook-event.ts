import { pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Webhook idempotency ledger.
 *
 * One row per (provider, provider-event-id) we have durably applied. Inserted
 * with `onConflictDoNothing` BEFORE any side effect runs, so a retried/replayed
 * delivery (Stripe retries on non-2xx, at-least-once by design) is detected by
 * the zero-rows-inserted result and skipped instead of re-applying money-moving
 * effects (e.g. re-granting credits on a billing webhook).
 *
 * System-level, not org-scoped — webhook handlers run under system scope with
 * no org/auth context, and one physical Stripe event id is global. No
 * `organization_id` column, so it is intentionally outside the org-RLS bucket.
 */
export const processedWebhookEvent = pgTable(
  'processed_webhook_event',
  {
    /** Logical source, e.g. 'stripe_billing', 'stripe_connect', 'twilio', 'resend'. */
    provider: text('provider').notNull(),
    /** The provider's own event id (Stripe `event.id`, svix `svix-id`, etc.). */
    eventId: text('event_id').notNull(),
    processedAt: timestamp('processed_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'processed_webhook_event_pkey',
      columns: [table.provider, table.eventId],
    }),
  ]
);

export type ProcessedWebhookEvent = typeof processedWebhookEvent.$inferSelect;
export type NewProcessedWebhookEvent =
  typeof processedWebhookEvent.$inferInsert;
