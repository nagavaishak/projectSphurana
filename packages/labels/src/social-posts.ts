/**
 * Social post enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Social post status labels
export const socialPostStatusLabels = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  publishing: 'Publishing',
  published: 'Published',
  partial: 'Partial',
  failed: 'Failed',
} as const;

export const socialPostStatusValues = Object.keys(socialPostStatusLabels) as [
  keyof typeof socialPostStatusLabels,
  ...(keyof typeof socialPostStatusLabels)[],
];

export type SocialPostStatus = keyof typeof socialPostStatusLabels;

// Social post media type labels
export const socialPostMediaTypeLabels = {
  image: 'Image',
  video: 'Video',
} as const;

export const socialPostMediaTypeValues = Object.keys(
  socialPostMediaTypeLabels
) as [
  keyof typeof socialPostMediaTypeLabels,
  ...(keyof typeof socialPostMediaTypeLabels)[],
];

export type SocialPostMediaType = keyof typeof socialPostMediaTypeLabels;

// Social platform labels
export const socialPlatformLabels = {
  facebook: 'Facebook',
  instagram: 'Instagram',
} as const;

export const socialPlatformValues = Object.keys(socialPlatformLabels) as [
  keyof typeof socialPlatformLabels,
  ...(keyof typeof socialPlatformLabels)[],
];

export type SocialPlatform = keyof typeof socialPlatformLabels;
