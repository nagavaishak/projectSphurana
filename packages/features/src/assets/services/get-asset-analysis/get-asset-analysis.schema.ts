import { z } from 'zod';

/**
 * Get asset analysis input schema
 */
export const getAssetAnalysisSchema = z.object({
  assetId: z.string().min(1, 'Asset ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GetAssetAnalysisInput = z.infer<typeof getAssetAnalysisSchema>;
