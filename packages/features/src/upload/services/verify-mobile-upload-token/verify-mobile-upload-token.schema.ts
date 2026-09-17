import { z } from 'zod';

export const verifyMobileUploadTokenSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

export type VerifyMobileUploadTokenInput = z.infer<
  typeof verifyMobileUploadTokenSchema
>;
