import { z } from 'zod';

/**
 * Schema for deleting a social post
 */
export const deleteSocialPostSchema = z.object({
  id: z.string().min(1, 'Social post ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

/**
 * Input type inferred from schema
 */
export type DeleteSocialPostInput = z.infer<typeof deleteSocialPostSchema>;
