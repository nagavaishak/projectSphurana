import { assetContentTypeValues } from '@borradh-workspace/labels';
import { z } from 'zod';

export const updateAssetContentTypeSchema = z.object({
  assetId: z.string().min(1, 'Asset ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  contentType: z.enum(assetContentTypeValues),
});

export type UpdateAssetContentTypeInput = z.infer<
  typeof updateAssetContentTypeSchema
>;
