import { z } from 'zod';

/**
 * Delete Asset Input Schema
 */
export const deleteAssetInputSchema = z.object({
  id: z.string().min(1, 'Asset ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  actorId: z.string().optional(),
});

export type DeleteAssetInput = z.infer<typeof deleteAssetInputSchema>;
