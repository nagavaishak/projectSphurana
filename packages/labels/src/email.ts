/**
 * Email enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Email provider labels
export const emailProviderLabels = {
  gmail: 'Gmail',
  outlook: 'Outlook',
} as const;

export const emailProviderValues = Object.keys(emailProviderLabels) as [
  keyof typeof emailProviderLabels,
  ...(keyof typeof emailProviderLabels)[],
];

export type EmailProvider = keyof typeof emailProviderLabels;
