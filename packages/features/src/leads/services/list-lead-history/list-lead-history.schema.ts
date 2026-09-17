import { z } from 'zod';

/**
 * Schema for listing lead history (executions + activities)
 */
export const listLeadHistorySchema = z.object({
  leadId: z.string().min(1, 'Lead ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export type ListLeadHistoryInput = z.infer<typeof listLeadHistorySchema>;
