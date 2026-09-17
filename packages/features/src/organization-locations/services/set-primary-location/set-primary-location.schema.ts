import { z } from 'zod';

/**
 * Schema for setting a location as primary
 */
export const setPrimaryLocationSchema = z.object({
  id: z.string().min(1, 'Location ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type SetPrimaryLocationInput = z.infer<typeof setPrimaryLocationSchema>;
