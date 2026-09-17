import { z } from 'zod';

/**
 * Update asset tags input schema
 */
export const updateAssetTagsSchema = z.object({
  assetId: z.string().min(1, 'Asset ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  /** Tags to set for this asset (replaces existing tags) */
  tags: z.array(z.string().min(1).max(50)).max(20, 'Maximum 20 tags allowed'),
});

export type UpdateAssetTagsInput = z.infer<typeof updateAssetTagsSchema>;

/**
 * Add asset tags input schema
 */
export const addAssetTagsSchema = z.object({
  assetId: z.string().min(1, 'Asset ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  /** Tags to add to this asset */
  tags: z
    .array(z.string().min(1).max(50))
    .min(1, 'At least one tag is required'),
});

export type AddAssetTagsInput = z.infer<typeof addAssetTagsSchema>;

/**
 * Remove asset tags input schema
 */
export const removeAssetTagsSchema = z.object({
  assetId: z.string().min(1, 'Asset ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  /** Tags to remove from this asset */
  tags: z
    .array(z.string().min(1).max(50))
    .min(1, 'At least one tag is required'),
});

export type RemoveAssetTagsInput = z.infer<typeof removeAssetTagsSchema>;
