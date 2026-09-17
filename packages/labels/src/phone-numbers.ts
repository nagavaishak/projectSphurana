/**
 * Phone number enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Phone number status labels
export const phoneNumberStatusLabels = {
  pending_registration: 'Pending Registration',
  active: 'Active',
  suspended: 'Suspended',
  releasing: 'Releasing',
  released: 'Released',
  failed: 'Failed',
} as const;

export const phoneNumberStatusValues = Object.keys(phoneNumberStatusLabels) as [
  keyof typeof phoneNumberStatusLabels,
  ...(keyof typeof phoneNumberStatusLabels)[],
];

export type PhoneNumberStatus = keyof typeof phoneNumberStatusLabels;

// Phone number provider labels
export const phoneNumberProviderLabels = {
  telnyx: 'Telnyx',
  manual: 'Manual',
} as const;

export const phoneNumberProviderValues = Object.keys(
  phoneNumberProviderLabels
) as [
  keyof typeof phoneNumberProviderLabels,
  ...(keyof typeof phoneNumberProviderLabels)[],
];

export type PhoneNumberProvider = keyof typeof phoneNumberProviderLabels;
