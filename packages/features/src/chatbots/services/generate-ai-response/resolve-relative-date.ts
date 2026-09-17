/**
 * Chatbot-facing wrapper around the shared date-expression resolver
 * (`shared/resolve-date/`). Resolves relative date strings (e.g. "tomorrow",
 * "this week") to a single YYYY-MM-DD availability-check date.
 *
 * Legacy contract preserved:
 *   - always returns a usable date (never null) — unknown expressions fall
 *     back to tomorrow, because an availability check needs SOME day;
 *   - week-ish/vague expressions ("this week", "next available") resolve to
 *     the earliest useful day (tomorrow), never a day in the past.
 *
 * Pass the org's IANA `timezone` so "today"/"tomorrow" are the business's
 * wall-clock days; it defaults to the server's local zone for compatibility
 * with older call sites.
 */
import {
  addDays,
  resolveDateExpression,
  todayInTimezone,
} from '../../../shared/resolve-date/index.js';

export function resolveRelativeDate(
  dateStr: string,
  timezone?: string
): string {
  const tz = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const options = { timezone: tz };
  const today = todayInTimezone(options);
  const tomorrow = addDays(today, 1);

  // Already in YYYY-MM-DD format — pass through unchanged.
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

  const resolved = resolveDateExpression(dateStr, options);
  if (!resolved) return tomorrow;
  if (resolved.kind === 'date' || resolved.kind === 'datetime') {
    // Never offer a past day for an availability check.
    return resolved.date >= today ? resolved.date : tomorrow;
  }
  // Range ("this week", "next 2 weeks", …) → the earliest useful day in the
  // window: its start, clamped forward to tomorrow.
  return resolved.start > tomorrow ? resolved.start : tomorrow;
}

/** Format a Date's LOCAL calendar date as YYYY-MM-DD (legacy helper). */
export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
