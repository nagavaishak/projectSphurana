import { z } from 'zod';

/**
 * Schema for deleting an organization service
 */
export const deleteServiceSchema = z.object({
  id: z.string().min(1, 'Service ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

/**
 * Input type inferred from schema
 */
export type DeleteServiceInput = z.infer<typeof deleteServiceSchema>;
