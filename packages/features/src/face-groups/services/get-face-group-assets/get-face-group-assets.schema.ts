import { z } from 'zod';

export const getFaceGroupAssetsSchema = z.object({
  faceGroupId: z.string().min(1),
  organizationId: z.string().min(1),
});

export type GetFaceGroupAssetsInput = z.infer<typeof getFaceGroupAssetsSchema>;
