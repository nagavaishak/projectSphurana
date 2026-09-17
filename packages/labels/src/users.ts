/**
 * User enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

export const userColorLabels = {
  blue: 'Blue',
  green: 'Green',
  red: 'Red',
  yellow: 'Yellow',
  purple: 'Purple',
  orange: 'Orange',
} as const;

export const userColorValues = Object.keys(userColorLabels) as [
  keyof typeof userColorLabels,
  ...(keyof typeof userColorLabels)[],
];

export type UserColor = keyof typeof userColorLabels;
