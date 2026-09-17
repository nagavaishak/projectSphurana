import { z } from 'zod';

/**
 * Schema for deleting an organization location
 */
export const deleteLocationSchema = z.object({
  id: z.string().min(1, 'Location ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type DeleteLocationInput = z.infer<typeof deleteLocationSchema>;
