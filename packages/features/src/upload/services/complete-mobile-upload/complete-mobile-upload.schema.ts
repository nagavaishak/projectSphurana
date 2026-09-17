import { z } from 'zod';

export const completeMobileUploadSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  contentType: z.string().optional(),
});

export type CompleteMobileUploadInput = z.infer<
  typeof completeMobileUploadSchema
>;
