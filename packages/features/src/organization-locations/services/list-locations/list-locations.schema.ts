import { z } from 'zod';

/**
 * Schema for listing organization locations
 */
export const listLocationsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type ListLocationsInput = z.infer<typeof listLocationsSchema>;
