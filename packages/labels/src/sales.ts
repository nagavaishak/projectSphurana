/**
 * Sales / POS enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Sale status labels
export const saleStatusLabels = {
  open: 'Open',
  completed: 'Completed',
  refunded: 'Refunded',
  partially_refunded: 'Partially Refunded',
  voided: 'Voided',
} as const;

export const saleStatusValues = Object.keys(saleStatusLabels) as [
  keyof typeof saleStatusLabels,
  ...(keyof typeof saleStatusLabels)[],
];

export type SaleStatus = keyof typeof saleStatusLabels;

// Sale tip type labels
export const saleTipTypeLabels = {
  none: 'No Tip',
  percent: 'Percentage',
  amount: 'Fixed Amount',
} as const;

export const saleTipTypeValues = Object.keys(saleTipTypeLabels) as [
  keyof typeof saleTipTypeLabels,
  ...(keyof typeof saleTipTypeLabels)[],
];

export type SaleTipType = keyof typeof saleTipTypeLabels;

// Sale item type labels
export const saleItemTypeLabels = {
  appointment: 'Appointment',
  service: 'Service',
  product: 'Product',
  membership: 'Membership',
  gift_card: 'Gift Card',
  manual: 'Manual payment',
} as const;

export const saleItemTypeValues = Object.keys(saleItemTypeLabels) as [
  keyof typeof saleItemTypeLabels,
  ...(keyof typeof saleItemTypeLabels)[],
];

export type SaleItemType = keyof typeof saleItemTypeLabels;

// Sale payment method labels.
//
// `deposit` is NOT operator-selectable — the checkout's tender picker runs off
// explicit allowlists, and this one is seeded by `createSaleFromAppointment`
// from an already-paid `appointment_deposit`. It exists as a tender rather than
// a discount so the subtotal stays honest and balance-due arithmetic falls out
// of the existing `sum(succeeded tenders) >= totalCents` rule.
//
// APPENDED, not inserted: `salePaymentMethodValues` is `Object.keys(...)`, so
// position determines the Postgres enum's value order.
export const salePaymentMethodLabels = {
  cash: 'Cash',
  card_terminal: 'Card Terminal',
  qr_self_checkout: 'QR Self-Checkout',
  manual_card: 'Manual Card Entry',
  gift_card: 'Gift Card',
  deposit: 'Deposit',
  // An online shop order is settled by a Stripe Checkout Session rather than
  // the staff-facing terminal or manually-entered-card flows.
  online_checkout: 'Online checkout',
} as const;

/** How a completed sale reaches the customer. `ship` is stored now but not
 * offered by the V1 shop. */
export const saleFulfilmentMethodLabels = {
  collect: 'Collection',
  ship: 'Delivery',
} as const;

export const saleFulfilmentMethodValues = Object.keys(
  saleFulfilmentMethodLabels
) as [
  keyof typeof saleFulfilmentMethodLabels,
  ...(keyof typeof saleFulfilmentMethodLabels)[],
];

export type SaleFulfilmentMethod = keyof typeof saleFulfilmentMethodLabels;

/** A till sale has no fulfilment work. Online shop orders move through the
 * remaining states. `dispatched` is reserved for the later delivery flow. */
export const saleFulfilmentStatusLabels = {
  not_applicable: 'Not applicable',
  awaiting_collection: 'Awaiting collection',
  ready: 'Ready to collect',
  collected: 'Collected',
  dispatched: 'Dispatched',
} as const;

export const saleFulfilmentStatusValues = Object.keys(
  saleFulfilmentStatusLabels
) as [
  keyof typeof saleFulfilmentStatusLabels,
  ...(keyof typeof saleFulfilmentStatusLabels)[],
];

export type SaleFulfilmentStatus = keyof typeof saleFulfilmentStatusLabels;

export const salePaymentMethodValues = Object.keys(salePaymentMethodLabels) as [
  keyof typeof salePaymentMethodLabels,
  ...(keyof typeof salePaymentMethodLabels)[],
];

export type SalePaymentMethod = keyof typeof salePaymentMethodLabels;

// Sale payment status labels
export const salePaymentStatusLabels = {
  pending: 'Pending',
  succeeded: 'Succeeded',
  failed: 'Failed',
  refunded: 'Refunded',
} as const;

export const salePaymentStatusValues = Object.keys(salePaymentStatusLabels) as [
  keyof typeof salePaymentStatusLabels,
  ...(keyof typeof salePaymentStatusLabels)[],
];

export type SalePaymentStatus = keyof typeof salePaymentStatusLabels;
