import { z } from 'zod';

/**
 * Input for copy-on-attach minting: ensures an org-owned `asset` row exists for
 * each requested stock clip, deduped per (org, clip). Org-owned (not a shared
 * system row) so the asset carries the org RLS policy and the queueVideoExport
 * gate sees it under withOrgScope.
 */
export const mintStockAssetsSchema = z.object({
  organizationId: z.string().min(1),
  uploadedById: z.string().min(1),
  stockClipIds: z.array(z.string().min(1)),
});

export type MintStockAssetsInput = z.infer<typeof mintStockAssetsSchema>;
