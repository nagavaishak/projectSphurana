import { z } from 'zod';

/**
 * Schema for getting a single social post
 */
export const getSocialPostSchema = z.object({
  id: z.string().min(1, 'Social post ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

/**
 * Input type inferred from schema
 */
export type GetSocialPostInput = z.infer<typeof getSocialPostSchema>;
