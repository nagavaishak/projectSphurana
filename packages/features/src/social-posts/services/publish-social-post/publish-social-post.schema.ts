import { z } from 'zod';

/**
 * Schema for publishing a social post
 */
export const publishSocialPostSchema = z.object({
  id: z.string().min(1, 'Social post ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

/**
 * Input type inferred from schema
 */
export type PublishSocialPostInput = z.infer<typeof publishSocialPostSchema>;
