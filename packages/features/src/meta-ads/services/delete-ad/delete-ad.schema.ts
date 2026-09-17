import { z } from 'zod';

/**
 * Schema for deleting an ad
 */
export const deleteAdSchema = z.object({
  adId: z.string().min(1, 'Ad ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

/**
 * Input type for deleting an ad
 */
export type DeleteAdInput = z.infer<typeof deleteAdSchema>;
