import { z } from 'zod';

/**
 * Get Bulk Assets Status Input Schema
 * Either batchId or assetIds must be provided
 */
export const getBulkAssetsStatusInputSchema = z
  .object({
    organizationId: z.string().min(1, 'Organization ID is required'),
    /** Batch ID to get status for all assets in a batch */
    batchId: z.string().optional(),
    /** Array of asset IDs to get status for specific assets */
    assetIds: z.array(z.string()).optional(),
  })
  .refine(
    (data) => data.batchId || (data.assetIds && data.assetIds.length > 0),
    {
      message: 'Either batchId or assetIds must be provided',
    }
  );

/**
 * Input type inferred from schema
 */
export type GetBulkAssetsStatusInput = z.infer<
  typeof getBulkAssetsStatusInputSchema
>;
