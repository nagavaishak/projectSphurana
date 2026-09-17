import { z } from 'zod';

/**
 * Schema for `listServiceIdsWithMedia` — returns the IDs of services that
 * have graphic-eligible uploaded media for the given org.
 */
export const listServicesWithMediaSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type ListServicesWithMediaInput = z.infer<
  typeof listServicesWithMediaSchema
>;
