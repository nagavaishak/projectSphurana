import { z } from 'zod';

/**
 * Schema for deleting a lead
 */
export const deleteLeadSchema = z.object({
  id: z.string().min(1, 'Lead ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  actorId: z.string().optional(),
});

/**
 * Input type inferred from schema
 */
export type DeleteLeadInput = z.infer<typeof deleteLeadSchema>;
