import { z } from 'zod';

export const getMobileUploadStatusSchema = z.object({
  videoId: z.string().min(1, 'Video ID is required'),
});

export type GetMobileUploadStatusInput = z.infer<
  typeof getMobileUploadStatusSchema
>;
