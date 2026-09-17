import { z } from 'zod';

export const getLeadExecutionHistorySchema = z.object({
  leadId: z.string().min(1, 'Lead ID is required'),
  sequenceId: z.string().min(1, 'Sequence ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GetLeadExecutionHistoryInput = z.infer<
  typeof getLeadExecutionHistorySchema
>;
