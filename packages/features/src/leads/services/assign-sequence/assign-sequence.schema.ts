import { z } from 'zod';

/**
 * Schema for assigning a sequence to a lead
 */
export const assignSequenceSchema = z.object({
  leadId: z.string().min(1, 'Lead ID is required'),
  sequenceId: z.string().min(1, 'Sequence ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

/**
 * Input type inferred from schema
 */
export type AssignSequenceInput = z.infer<typeof assignSequenceSchema>;
