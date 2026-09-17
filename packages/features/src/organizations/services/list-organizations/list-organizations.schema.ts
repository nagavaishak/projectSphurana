import { z } from 'zod';

/**
 * Schema for listing organizations
 */
export const listOrganizationsSchema = z.object({
  sessionToken: z.string().min(1, 'Session token is required'),
});

/**
 * Input type inferred from schema
 */
export type ListOrganizationsInput = z.infer<typeof listOrganizationsSchema>;
