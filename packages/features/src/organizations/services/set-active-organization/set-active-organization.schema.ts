import { z } from 'zod';

/**
 * Schema for set-active-organization input
 */
export const setActiveOrganizationSchema = z.object({
  sessionToken: z.string().min(1, 'Session token is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

/**
 * Input type for set-active-organization
 */
export type SetActiveOrganizationInput = z.infer<
  typeof setActiveOrganizationSchema
>;
