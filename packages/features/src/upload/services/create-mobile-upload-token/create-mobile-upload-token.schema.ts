import { z } from 'zod';

export const createMobileUploadTokenSchema = z.object({
  videoId: z.string().min(1, 'Video ID is required'),
  contentType: z.string().optional(),
  // Teleprompter script, carried in the token so an auth-free phone (magic-link
  // hand-off) can render the teleprompter without an authenticated video fetch.
  scriptText: z.string().optional(),
  userId: z.string().min(1),
  organizationId: z.string().min(1),
});

export type CreateMobileUploadTokenInput = z.infer<
  typeof createMobileUploadTokenSchema
>;
