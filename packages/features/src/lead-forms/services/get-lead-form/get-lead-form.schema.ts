import { z } from 'zod';

/**
 * Schema for getting a lead form
 */
export const getLeadFormSchema = z.object({
  id: z.string().min(1, 'Lead form ID is required'),
  organizationId: z.string().optional(), // Optional for access control
});

/**
 * Input type inferred from schema
 */
export type GetLeadFormInput = z.infer<typeof getLeadFormSchema>;
