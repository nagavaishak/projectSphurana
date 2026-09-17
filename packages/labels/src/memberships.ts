/**
 * Membership enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Membership pricing type labels
export const membershipPricingTypeLabels = {
  one_time: 'One-Time',
  recurring: 'Recurring',
} as const;

export const membershipPricingTypeValues = Object.keys(
  membershipPricingTypeLabels
) as [
  keyof typeof membershipPricingTypeLabels,
  ...(keyof typeof membershipPricingTypeLabels)[],
];

export type MembershipPricingType = keyof typeof membershipPricingTypeLabels;

// Membership validity duration labels
export const membershipValidForLabels = {
  '7d': '7 days',
  '14d': '14 days',
  '1m': '1 month',
  '2m': '2 months',
  '3m': '3 months',
  '4m': '4 months',
  '6m': '6 months',
  '8m': '8 months',
  '1y': '1 year',
  '18m': '18 months',
  '2y': '2 years',
  '3y': '3 years',
  '5y': '5 years',
} as const;

export const membershipValidForValues = Object.keys(
  membershipValidForLabels
) as [
  keyof typeof membershipValidForLabels,
  ...(keyof typeof membershipValidForLabels)[],
];

export type MembershipValidFor = keyof typeof membershipValidForLabels;

// Lead membership status labels
export const leadMembershipStatusLabels = {
  active: 'Active',
  past_due: 'Past Due',
  cancelled: 'Cancelled',
  expired: 'Expired',
} as const;

export const leadMembershipStatusValues = Object.keys(
  leadMembershipStatusLabels
) as [
  keyof typeof leadMembershipStatusLabels,
  ...(keyof typeof leadMembershipStatusLabels)[],
];

export type LeadMembershipStatus = keyof typeof leadMembershipStatusLabels;
