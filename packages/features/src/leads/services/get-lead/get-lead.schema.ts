import { z } from 'zod';

/**
 * Schema for getting a lead
 */
export const getLeadSchema = z.object({
  id: z.string().min(1, 'Lead ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

/**
 * Input type inferred from schema
 */
export type GetLeadInput = z.infer<typeof getLeadSchema>;
