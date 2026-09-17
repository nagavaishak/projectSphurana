import { z } from 'zod';

/**
 * Schema for the scheduled-post publish sweep.
 */
export const publishDuePostsSchema = z.object({
  // Max posts to publish per sweep. Keeps a single tick bounded — the next
  // tick picks up the remainder.
  batchSize: z.number().int().positive().max(200).default(15),

  // Posts whose scheduledAt is older than this many hours are considered
  // stale and are NOT auto-published (they're skipped and counted, so a
  // long-overdue backlog never blasts out unexpectedly). They stay
  // `scheduled` for manual handling.
  maxOverdueHours: z.number().int().positive().default(48),
});

// `z.input` (not `z.infer`/output) so the defaulted fields are optional —
// callers can pass `{}` and let the schema fill the defaults.
export type PublishDuePostsInput = z.input<typeof publishDuePostsSchema>;
