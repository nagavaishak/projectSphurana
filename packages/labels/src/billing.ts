/**
 * Billing enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Subscription status labels
export const subscriptionStatusLabels = {
  active: 'Active',
  canceled: 'Canceled',
  incomplete: 'Incomplete',
  incomplete_expired: 'Incomplete Expired',
  past_due: 'Past Due',
  trialing: 'Trialing',
  unpaid: 'Unpaid',
  paused: 'Paused',
} as const;

export const subscriptionStatusValues = Object.keys(
  subscriptionStatusLabels
) as [
  keyof typeof subscriptionStatusLabels,
  ...(keyof typeof subscriptionStatusLabels)[],
];

export type SubscriptionStatus = keyof typeof subscriptionStatusLabels;

// Credit transaction type labels
export const creditTransactionTypeLabels = {
  subscription_refill: 'Subscription Refill',
  purchase: 'Purchase',
  usage: 'Usage',
  refund: 'Refund',
  adjustment: 'Adjustment',
} as const;

export const creditTransactionTypeValues = Object.keys(
  creditTransactionTypeLabels
) as [
  keyof typeof creditTransactionTypeLabels,
  ...(keyof typeof creditTransactionTypeLabels)[],
];

export type CreditTransactionType = keyof typeof creditTransactionTypeLabels;

// Credit channel labels
export const creditChannelLabels = {
  sms: 'SMS',
  email: 'Email',
  voice: 'Voice',
  whatsapp: 'WhatsApp',
} as const;

export const creditChannelValues = Object.keys(creditChannelLabels) as [
  keyof typeof creditChannelLabels,
  ...(keyof typeof creditChannelLabels)[],
];

export type CreditChannel = keyof typeof creditChannelLabels;

// Invoice status labels
export const invoiceStatusLabels = {
  draft: 'Draft',
  open: 'Open',
  paid: 'Paid',
  void: 'Void',
  uncollectible: 'Uncollectible',
} as const;

export const invoiceStatusValues = Object.keys(invoiceStatusLabels) as [
  keyof typeof invoiceStatusLabels,
  ...(keyof typeof invoiceStatusLabels)[],
];

export type InvoiceStatus = keyof typeof invoiceStatusLabels;
