import { z } from 'zod';

/**
 * Schema for resolving the active location of a request.
 */
export const resolveActiveLocationSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  locationId: z.string().min(1, 'Location ID is required'),
});

export type ResolveActiveLocationInput = z.infer<
  typeof resolveActiveLocationSchema
>;
