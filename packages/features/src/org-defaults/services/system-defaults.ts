/**
 * System-wide defaults used when an org hasn't set its own values.
 *
 * Tuned for an aesthetic clinic doing lead-gen on Meta:
 *  - €10/day is a reasonable starting daily budget for a single ad set.
 *  - OUTCOME_LEADS is Meta's leads objective (lead forms / messaging).
 *  - 60s landscape video is the most reusable format (works for in-feed +
 *    YouTube + website embeds; portrait variants are derived).
 */
export const SYSTEM_DEFAULTS = {
  // Auto-assign rooms by default: a clinic that sets rooms up expects them to
  // be allocated without extra front-desk work.
  resourceAssignmentMode: 'auto',
  adDailyBudgetCents: 1000, // €10.00/day
  adObjective: 'OUTCOME_LEADS',
  videoOrientation: 'landscape',
  videoLengthSecs: 60,
  // Wage / auto-clock workspace defaults (contract §1.1.8)
  wageAutoClockIn: false,
  wageAutoClockOut: false,
  wageAutomatedBreaks: false,
  // Gift card org settings (cents; expiry key from giftCardExpiryLabels)
  giftCardPresetAmounts: [2500, 5000, 7500, 10000, 15000],
  giftCardExpiry: 'never',
} as const;

export type SystemDefaults = typeof SYSTEM_DEFAULTS;
