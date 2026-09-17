import { z } from 'zod';

export const startSocialPostPublishSchema = z.object({
  id: z.string().min(1, 'Post ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type StartSocialPostPublishInput = z.infer<
  typeof startSocialPostPublishSchema
>;
