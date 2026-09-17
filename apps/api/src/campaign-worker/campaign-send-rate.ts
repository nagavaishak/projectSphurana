/**
 * Queue-wide send ceiling for the campaign-send queue, in jobs per second.
 *
 * Pinned to the TIGHTEST provider cap on this queue — Resend's 10 req/s —
 * because one queue carries all three channels and BullMQ's limiter is
 * queue-wide, not per-channel. It was 50/s, five times over: with
 * `concurrency: 10` and a ~200ms send that rate is reachable, and exceeding it
 * is not merely noisy. Resend replies 429, the sender marks the outcome
 * retryable, the recipient goes back to 'queued' and the job throws to trigger
 * BullMQ backoff — but only MAX_ATTEMPTS times, after which the recipient is
 * moved to the DLQ. Sustained rate-limiting therefore DROPS messages, which is
 * why this is a delivery bug and not a logging one.
 *
 * The cost, accepted deliberately: WhatsApp and SMS are held to email's ceiling
 * too. Quantified so it is a decision rather than a surprise mid-campaign —
 * 10/s is 600 recipients a minute, 36,000 an hour, across all channels
 * combined. A campaign larger than that takes longer to drain; nothing is
 * dropped, because a limited job waits in the queue rather than failing. That
 * is strictly better than the 50/s it replaces, where the excess reached Resend,
 * came back 429, and burned MAX_ATTEMPTS before the recipient hit the DLQ —
 * slower delivery instead of lost delivery.
 *
 * Lifting the ceiling for the non-email channels needs the per-org/channel
 * token bucket in `campaign-send.worker.ts`'s Phase 4 TODO, so email can be
 * throttled without capping the other two.
 *
 * Kept in its own module, free of imports, so the constraint can be asserted
 * without constructing a Worker (which needs Redis and pulls ESM-only deps).
 */
export const CAMPAIGN_SEND_MAX_PER_SECOND = 10;
