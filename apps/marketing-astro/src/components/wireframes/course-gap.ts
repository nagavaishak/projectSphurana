/**
 * Session-gap copy, derived from two integers.
 *
 * `min_days_between_sessions` and `max_days_between_sessions` are plain nullable
 * ints on the `course` table. The clinic never writes the sentence — there is
 * one sentence shape and the numbers vary — so that a course edited from 28 to
 * 35 days cannot end up with copy still saying 28.
 *
 * Four cases, one shape:
 *
 *   min + max   "Sessions must be between 28 and 42 days apart"
 *   min only    "Sessions must be at least 28 days apart"
 *   max only    "Sessions must be no more than 42 days apart"
 *   neither     null — render nothing, not an empty block
 */

/**
 * Named for the columns, not for the function. The whole point of deriving copy
 * is that there is exactly one place the numbers live — giving them a second
 * set of names here would reintroduce the drift the derivation removes.
 */
export interface SessionGap {
  minDaysBetweenSessions: number | null;
  maxDaysBetweenSessions: number | null;
}

/** The one-line rule shown on a course card and detail page. */
export function sessionGapSentence({
  minDaysBetweenSessions: minDays,
  maxDaysBetweenSessions: maxDays,
}: SessionGap): string | null {
  if (minDays != null && maxDays != null) {
    return `Sessions must be between ${minDays} and ${maxDays} days apart`;
  }
  if (minDays != null) {
    return `Sessions must be at least ${minDays} days apart`;
  }
  if (maxDays != null) {
    return `Sessions must be no more than ${maxDays} days apart`;
  }
  return null;
}

/**
 * Why the rule exists, keyed off the service rather than stored per course.
 *
 * Deliberately NOT a free-text column: every laser course has the same reason,
 * and asking each clinic to write it produces either nothing or something
 * clinically wrong. A short lookup keeps it consistent and correct, and a course
 * whose service has no entry simply shows no explanation.
 */
const GAP_REASON: Record<string, string> = {
  laser:
    'Hair grows in cycles. Too soon and the session does nothing; too late and you lose the progress from the last one.',
  peel: 'Your skin needs time to recover fully between treatments.',
  injectable:
    'Leaving the right gap keeps results even and avoids over-treating an area.',
};

export function sessionGapReason(serviceKind: string | null): string | null {
  return serviceKind ? (GAP_REASON[serviceKind] ?? null) : null;
}
