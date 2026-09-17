import { z } from 'zod';

/**
 * Schema for getting organization brand configuration
 */
export const getOrganizationBrandSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

/**
 * Input type inferred from schema
 */
export type GetOrganizationBrandInput = z.infer<
  typeof getOrganizationBrandSchema
>;
