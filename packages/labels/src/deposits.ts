/**
 * Deposit enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Deposit status labels
export const depositStatusLabels = {
  pending: 'Pending',
  paid: 'Paid',
  expired: 'Expired',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
} as const;

export const depositStatusValues = Object.keys(depositStatusLabels) as [
  keyof typeof depositStatusLabels,
  ...(keyof typeof depositStatusLabels)[],
];

export type DepositStatus = keyof typeof depositStatusLabels;

/**
 * What a customer pays WHEN they book, per service.
 *
 * Replaces the `requiresDeposit` boolean, which could express only two of these
 * three states — `full` had no representation at all. See
 * docs/plans/service-pricing-model.md §6 and
 * docs/plans/payment-policy-and-deposits.md.
 */
export const servicePaymentPolicyLabels = {
  /** Nothing online; the practitioner rings it up at the POS after the visit. */
  in_clinic: 'Pay at the clinic',
  /** Part now, remainder at the POS. */
  deposit: 'Deposit at booking',
  /** The whole price up front. Only offerable where the exact price resolves. */
  full: 'Pay in full at booking',
} as const;

export const servicePaymentPolicyValues = Object.keys(
  servicePaymentPolicyLabels
) as [
  keyof typeof servicePaymentPolicyLabels,
  ...(keyof typeof servicePaymentPolicyLabels)[],
];

export type ServicePaymentPolicy = keyof typeof servicePaymentPolicyLabels;

/**
 * How a `deposit` amount is arrived at.
 *
 * `percent` is only meaningful where an exact price exists — a percentage of a
 * `from` floor under-charges every time, and `poa` has no base at all — so the
 * service form offers `fixed` for those.
 */
export const depositBasisLabels = {
  fixed: 'Fixed amount',
  percent: 'Percentage of price',
} as const;

export const depositBasisValues = Object.keys(depositBasisLabels) as [
  keyof typeof depositBasisLabels,
  ...(keyof typeof depositBasisLabels)[],
];

export type DepositBasis = keyof typeof depositBasisLabels;

/**
 * How several deposit-bearing services on ONE appointment combine.
 *
 * A deposit protects against a no-show, and a no-show is per APPOINTMENT — the
 * customer either turns up or doesn't — so `largest` is the honest default.
 * `sum` (three deposits for one visit) is preserved for orgs already collecting
 * that way, because changing it silently would change their takings.
 */
export const depositAggregationLabels = {
  largest: 'Highest single deposit',
  sum: 'Total of every deposit',
} as const;

export const depositAggregationValues = Object.keys(
  depositAggregationLabels
) as [
  keyof typeof depositAggregationLabels,
  ...(keyof typeof depositAggregationLabels)[],
];

export type DepositAggregation = keyof typeof depositAggregationLabels;
