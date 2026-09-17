import { z } from 'zod';

/**
 * Get Asset Input Schema
 */
export const getAssetInputSchema = z.object({
  id: z.string().min(1, 'Asset ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GetAssetInput = z.infer<typeof getAssetInputSchema>;
