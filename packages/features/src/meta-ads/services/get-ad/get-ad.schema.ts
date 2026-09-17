import { z } from 'zod';

/**
 * Schema for getting an ad by ID
 */
export const getAdSchema = z.object({
  adId: z.string().min(1, 'Ad ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

/**
 * Input type for getting an ad
 */
export type GetAdInput = z.infer<typeof getAdSchema>;
