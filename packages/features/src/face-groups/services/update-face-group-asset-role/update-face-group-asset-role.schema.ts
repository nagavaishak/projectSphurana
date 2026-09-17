import { faceGroupAssetRoleValues } from '@borradh-workspace/labels';
import { z } from 'zod';

export const updateFaceGroupAssetRoleSchema = z.object({
  faceGroupId: z.string().min(1),
  assetId: z.string().min(1),
  organizationId: z.string().min(1),
  role: z.enum(faceGroupAssetRoleValues),
});

export type UpdateFaceGroupAssetRoleInput = z.infer<
  typeof updateFaceGroupAssetRoleSchema
>;
