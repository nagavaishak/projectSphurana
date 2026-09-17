import { z } from 'zod';
import { addMonths, todayInTimezone } from '../../shared/resolve-date/index.js';

/**
 * Time-correctness backstop for offer validity windows (Claire reliability
 * overhaul, Phase 3 — register #158: offers created pre-expired by 11 months
 * because the model did its own date arithmetic on a 2025 training prior).
 *
 * Shared by `createOfferSchema` and `updateOfferSchema` so the API and the
 * assistant tools enforce the same rule. The error messages deliberately
 * quote TODAY'S date so a model seeing the structured error can self-correct
 * in-turn.
 *
 * The past-`validUntil` half is CREATE-only (`checkPastEnd`). On update the
 * same rule cannot be applied blind: the offer edit dialog round-trips the
 * offer's existing `validUntil` in a full-body PUT, so an already-expired
 * offer could never be edited again (not even renamed). The update path
 * instead enforces the rule in `updateOfferImpl`, where the stored row is in
 * hand and an unchanged echo can be told apart from a genuine move into the
 * past. See `pastValidUntilMessage`.
 */

/** Small grace so "ends now"-ish writes and clock skew don't flake. */
export const PAST_GRACE_MS = 5 * 60 * 1000;

/** How far ahead `validFrom` may plausibly start. */
const MAX_START_MONTHS_AHEAD = 13;

/** Shared wording so create- and update-side rejections read identically. */
export function pastValidUntilMessage(validUntil: Date, now = new Date()) {
  const today = todayInTimezone({ timezone: 'UTC', now });
  return `validUntil (${validUntil.toISOString()}) is in the past — today is ${today} (UTC). An offer must end in the future; re-resolve the end date from today's date and try again.`;
}

export function offerValidityIssues(
  data: { validFrom?: Date | null; validUntil?: Date | null },
  ctx: z.RefinementCtx,
  options: { checkPastEnd: boolean }
): void {
  const now = new Date();
  const today = todayInTimezone({ timezone: 'UTC', now });

  if (
    options.checkPastEnd &&
    data.validUntil &&
    data.validUntil.getTime() < now.getTime() - PAST_GRACE_MS
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['validUntil'],
      message: pastValidUntilMessage(data.validUntil, now),
    });
  }

  if (data.validFrom) {
    const limit = new Date(
      `${addMonths(today, MAX_START_MONTHS_AHEAD)}T23:59:59.999Z`
    );
    if (data.validFrom.getTime() > limit.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['validFrom'],
        message: `validFrom (${data.validFrom.toISOString()}) is more than ${MAX_START_MONTHS_AHEAD} months ahead — today is ${today} (UTC). Check the year and try again.`,
      });
    }
  }
}
