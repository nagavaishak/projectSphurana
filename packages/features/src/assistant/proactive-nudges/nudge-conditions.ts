import type { ClaireNudgeTemplateName } from './templates.js';

/**
 * Pure nudge-decision logic (WS-11, plan §4 WS-11). NO I/O — every input is
 * supplied by the caller (the scheduler gathers it via existing services). This
 * keeps the gating rules — quiet hours, per-owner frequency cap, per-owner
 * opt-out, and the `assistant_usage` daily cap (Q5) — trivially unit-testable.
 */

/** A candidate nudge for one paired owner, before gating. */
export interface NudgeCandidate {
  template: ClaireNudgeTemplateName;
  /** Ordered template parameters (must match the template's `paramOrder`). */
  params: string[];
}

export interface NudgeOwnerSignals {
  organizationId: string;
  userId: string;
  /** Owner's paired E.164 (digits only). */
  phoneE164: string;
  /** True if the owner has opted out of proactive nudges. */
  optedOut: boolean;
  /**
   * Timestamp of the most recent proactive nudge we sent this owner, or null if
   * never. Drives the frequency cap (no new storage — derived from the owner's
   * whatsapp `assistant_message` history, see the scheduler).
   */
  lastNudgeAt: Date | null;
  /**
   * The org's assistant message count for today (the `assistant_usage` daily
   * counter, Q5). A nudge is suppressed once the org is at/over its daily cap.
   */
  usageToday: number;
  /** The org's daily assistant message cap (from the plan/subscription tier). */
  usageDailyCap: number;
  /** The candidate nudge to evaluate (null if nothing qualifies for this owner). */
  candidate: NudgeCandidate | null;
}

export interface NudgePolicy {
  /** Local hour [0-24) at/after which nudges are allowed (inclusive). */
  quietHoursEndHour: number;
  /** Local hour [0-24) at/after which nudges stop (exclusive). */
  quietHoursStartHour: number;
  /** Minimum hours between two nudges to the same owner. */
  minHoursBetweenNudges: number;
}

/**
 * Default policy: nudge only between 09:00 and 20:00 (owner-local, but we
 * evaluate against `nowHourLocal` the caller supplies), at most once every 20
 * hours per owner. Conservative — a daily recap lands once a day without ever
 * doubling up or arriving at night.
 */
export const DEFAULT_NUDGE_POLICY: NudgePolicy = {
  quietHoursEndHour: 9,
  quietHoursStartHour: 20,
  minHoursBetweenNudges: 20,
};

export type NudgeSkipReason =
  | 'opted_out'
  | 'no_candidate'
  | 'quiet_hours'
  | 'frequency_cap'
  | 'usage_cap';

export type NudgeDecision =
  | { send: true; candidate: NudgeCandidate }
  | { send: false; reason: NudgeSkipReason };

const HOUR_MS = 60 * 60 * 1000;

/**
 * Is `hour` (0-23) inside the allowed window [end, start)? With the defaults
 * (9, 20) the allowed window is 09:00–19:59.
 */
export function isWithinQuietHours(hour: number, policy: NudgePolicy): boolean {
  return hour < policy.quietHoursEndHour || hour >= policy.quietHoursStartHour;
}

/**
 * THE decision function. Evaluate one owner's signals against the policy and
 * `now`. Order of checks is fixed so the skip reason is deterministic:
 *   opt-out → no candidate → quiet hours → frequency cap → usage cap.
 */
export function decideNudge(
  signals: NudgeOwnerSignals,
  now: Date,
  nowHourLocal: number,
  policy: NudgePolicy = DEFAULT_NUDGE_POLICY
): NudgeDecision {
  if (signals.optedOut) {
    return { send: false, reason: 'opted_out' };
  }
  if (!signals.candidate) {
    return { send: false, reason: 'no_candidate' };
  }
  if (isWithinQuietHours(nowHourLocal, policy)) {
    return { send: false, reason: 'quiet_hours' };
  }
  if (signals.lastNudgeAt) {
    const elapsedHours =
      (now.getTime() - signals.lastNudgeAt.getTime()) / HOUR_MS;
    if (elapsedHours < policy.minHoursBetweenNudges) {
      return { send: false, reason: 'frequency_cap' };
    }
  }
  // Q5 — never push the org past its daily assistant cap with a proactive nudge.
  if (
    signals.usageDailyCap > 0 &&
    signals.usageToday >= signals.usageDailyCap
  ) {
    return { send: false, reason: 'usage_cap' };
  }
  return { send: true, candidate: signals.candidate };
}
