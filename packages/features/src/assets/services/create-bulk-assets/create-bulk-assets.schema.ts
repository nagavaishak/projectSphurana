import { placeholderTypeValues } from '@borradh-workspace/labels';
import { z } from 'zod';

/**
 * Single asset input schema (for bulk creation)
 */
const bulkAssetItemSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  blobUrl: z.string().url('Invalid URL'),
  sourceFileName: z.string().optional(),
  tags: z.array(z.string()).default([]),
  clientName: z.string().optional(),
  type: z.enum(['video', 'image']).default('video'),
  placeholderTypes: z.array(z.enum(placeholderTypeValues)).default([]),
  duration: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  transcript: z.string().optional(),
});

/**
 * Create Bulk Assets Input Schema
 */
export const createBulkAssetsInputSchema = z.object({
  assets: z
    .array(bulkAssetItemSchema)
    .min(1, 'At least one asset is required')
    .max(100, 'Maximum 100 assets per batch'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  uploadedById: z.string().min(1, 'Uploader ID is required'),
  /** Whether to automatically queue video assets for analysis */
  autoAnalyze: z.boolean().default(true),
});

/**
 * Input type inferred from schema
 */
export type CreateBulkAssetsInput = z.infer<typeof createBulkAssetsInputSchema>;

/**
 * Single asset item input type
 */
export type BulkAssetItem = z.infer<typeof bulkAssetItemSchema>;
