/**
 * Gift card enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Gift card transaction type labels
export const giftCardTransactionTypeLabels = {
  issue: 'Issued',
  redeem: 'Redeemed',
  adjust: 'Adjusted',
} as const;

export const giftCardTransactionTypeValues = Object.keys(
  giftCardTransactionTypeLabels
) as [
  keyof typeof giftCardTransactionTypeLabels,
  ...(keyof typeof giftCardTransactionTypeLabels)[],
];

export type GiftCardTransactionType =
  keyof typeof giftCardTransactionTypeLabels;

// Gift card expiry labels (org_defaults text column type only — no pgEnum)
export const giftCardExpiryLabels = {
  '14d': '14 days',
  '1m': '1 month',
  '2m': '2 months',
  '3m': '3 months',
  '6m': '6 months',
  '1y': '1 year',
  '2y': '2 years',
  '3y': '3 years',
  '5y': '5 years',
  never: 'Never',
} as const;

export const giftCardExpiryValues = Object.keys(giftCardExpiryLabels) as [
  keyof typeof giftCardExpiryLabels,
  ...(keyof typeof giftCardExpiryLabels)[],
];

export type GiftCardExpiry = keyof typeof giftCardExpiryLabels;
