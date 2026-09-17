/**
 * Offer enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Offer state — lifecycle of an offer record
export const offerStateLabels = {
  draft: 'Draft',
  active: 'Active',
  paused: 'Paused',
  expired: 'Expired',
} as const;

export const offerStateValues = Object.keys(offerStateLabels) as [
  keyof typeof offerStateLabels,
  ...(keyof typeof offerStateLabels)[],
];

export type OfferState = keyof typeof offerStateLabels;

// Offer discount type — discriminator for the discount-shape fields on offer.
// `percentage` and `fixed_amount` are the user-selectable types in the
// promotion dialog. `fixed_price` and `buy_x_get_y` are kept for back-compat
// with existing rows; the new UI does not surface them in the radio picker.
export const offerDiscountTypeLabels = {
  percentage: 'Percentage Discount',
  fixed_amount: 'Fixed Amount Discount',
  fixed_price: 'Fixed price',
  buy_x_get_y: 'Buy X, Get Y',
} as const;

export const offerDiscountTypeValues = Object.keys(offerDiscountTypeLabels) as [
  keyof typeof offerDiscountTypeLabels,
  ...(keyof typeof offerDiscountTypeLabels)[],
];

export type OfferDiscountType = keyof typeof offerDiscountTypeLabels;
