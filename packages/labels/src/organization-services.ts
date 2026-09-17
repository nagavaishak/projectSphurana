/**
 * Organization services enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Service category labels
export const serviceCategoryLabels = {
  treatment: 'Treatment',
  procedure: 'Procedure',
  product: 'Product',
  consultation: 'Consultation',
  other: 'Other',
} as const;

export const serviceCategoryValues = Object.keys(serviceCategoryLabels) as [
  keyof typeof serviceCategoryLabels,
  ...(keyof typeof serviceCategoryLabels)[],
];

export type ServiceCategory = keyof typeof serviceCategoryLabels;
