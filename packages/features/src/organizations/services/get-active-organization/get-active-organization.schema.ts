import { z } from 'zod';

/**
 * Schema for getting active organization
 */
export const getActiveOrganizationSchema = z.object({
  sessionToken: z.string().min(1, 'Session token is required'),
});

/**
 * Input type inferred from schema
 */
export type GetActiveOrganizationInput = z.infer<
  typeof getActiveOrganizationSchema
>;
