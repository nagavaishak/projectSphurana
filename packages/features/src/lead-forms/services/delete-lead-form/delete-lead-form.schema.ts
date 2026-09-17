import { z } from 'zod';

/**
 * Schema for deleting (archiving) a lead form
 */
export const deleteLeadFormSchema = z.object({
  id: z.string().min(1, 'Lead form ID is required'),
  organizationId: z.string().optional(), // Optional for access control
});

/**
 * Input type inferred from schema
 */
export type DeleteLeadFormInput = z.infer<typeof deleteLeadFormSchema>;
