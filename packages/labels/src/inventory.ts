/**
 * Inventory enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Product measure unit labels. Spelled out rather than abbreviated — these are
// only ever shown in the product form's picker, where "ml" next to "l" next to
// "fl oz" is easy to misread.
export const productMeasureUnitLabels = {
  ml: 'Millilitres',
  l: 'Litres',
  fl_oz: 'Fluid ounces',
  g: 'Grams',
  kg: 'Kilograms',
  gal: 'Gallons',
  oz: 'Ounces',
  lb: 'Pounds',
  cm: 'Centimetres',
  ft: 'Feet',
  in: 'Inches',
  whole: 'Whole item',
} as const;

export const productMeasureUnitValues = Object.keys(
  productMeasureUnitLabels
) as [
  keyof typeof productMeasureUnitLabels,
  ...(keyof typeof productMeasureUnitLabels)[],
];

export type ProductMeasureUnit = keyof typeof productMeasureUnitLabels;

// Stock order status labels
export const stockOrderStatusLabels = {
  draft: 'Draft',
  ordered: 'Ordered',
  partially_received: 'Partially Received',
  received: 'Received',
  cancelled: 'Cancelled',
} as const;

export const stockOrderStatusValues = Object.keys(stockOrderStatusLabels) as [
  keyof typeof stockOrderStatusLabels,
  ...(keyof typeof stockOrderStatusLabels)[],
];

export type StockOrderStatus = keyof typeof stockOrderStatusLabels;

// Stock order fee type labels
export const stockOrderFeeTypeLabels = {
  currency: 'Fixed Amount',
  percent: 'Percentage',
} as const;

export const stockOrderFeeTypeValues = Object.keys(stockOrderFeeTypeLabels) as [
  keyof typeof stockOrderFeeTypeLabels,
  ...(keyof typeof stockOrderFeeTypeLabels)[],
];

export type StockOrderFeeType = keyof typeof stockOrderFeeTypeLabels;

// Stock take status labels
export const stockTakeStatusLabels = {
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
} as const;

export const stockTakeStatusValues = Object.keys(stockTakeStatusLabels) as [
  keyof typeof stockTakeStatusLabels,
  ...(keyof typeof stockTakeStatusLabels)[],
];

export type StockTakeStatus = keyof typeof stockTakeStatusLabels;
