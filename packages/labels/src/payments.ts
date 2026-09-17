/**
 * Payment enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Payment status labels
export const paymentStatusLabels = {
  pending: 'Pending',
  paid: 'Paid',
  expired: 'Expired',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
} as const;

export const paymentStatusValues = Object.keys(paymentStatusLabels) as [
  keyof typeof paymentStatusLabels,
  ...(keyof typeof paymentStatusLabels)[],
];

export type PaymentStatus = keyof typeof paymentStatusLabels;
