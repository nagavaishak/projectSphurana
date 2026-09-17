/**
 * Face group enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Face group asset role labels
export const faceGroupAssetRoleLabels = {
  before: 'Before',
  after: 'After',
  untagged: 'Untagged',
} as const;

export const faceGroupAssetRoleValues = Object.keys(
  faceGroupAssetRoleLabels
) as [
  keyof typeof faceGroupAssetRoleLabels,
  ...(keyof typeof faceGroupAssetRoleLabels)[],
];

export type FaceGroupAssetRole = keyof typeof faceGroupAssetRoleLabels;
