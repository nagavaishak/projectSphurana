import { z } from 'zod';

/**
 * Default lookback window when callers don't provide an explicit `since`.
 * Seven days matches the brief's "this week" semantics (a rolling
 * trailing-week digest, not a calendar week).
 */
export const DEFAULT_SUMMARISE_WINDOW_DAYS = 7;

export const summariseConversationsThisWeekSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  /**
   * Inclusive lower bound. Default: 7 days before `until`. Coerced from
   * strings so callers (HTTP/API consumers, fixtures) can pass ISO-8601.
   */
  since: z.coerce.date().optional(),
  /**
   * Exclusive upper bound. Default: now. Coerced from strings.
   */
  until: z.coerce.date().optional(),
});

export type SummariseConversationsThisWeekInput = z.infer<
  typeof summariseConversationsThisWeekSchema
>;
