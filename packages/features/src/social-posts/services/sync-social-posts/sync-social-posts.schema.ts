import { z } from 'zod';

/**
 * Schema for syncing social posts with Meta
 */
export const syncSocialPostsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

/**
 * Input type inferred from schema
 */
export type SyncSocialPostsInput = z.infer<typeof syncSocialPostsSchema>;
