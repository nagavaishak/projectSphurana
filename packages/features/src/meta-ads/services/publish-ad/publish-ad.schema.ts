import { z } from 'zod';

/**
 * Schema for publishing an ad
 */
export const publishAdSchema = z.object({
  adId: z.string().min(1, 'Ad ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

/**
 * Input type for publishing an ad
 */
export type PublishAdInput = z.infer<typeof publishAdSchema>;
