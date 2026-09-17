import { leadFormStatusValues } from '@borradh-workspace/labels';
import { z } from 'zod';

/**
 * Schema for listing lead forms
 */
export const listLeadFormsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  status: z.enum(leadFormStatusValues).optional(),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

/**
 * Input type inferred from schema
 */
export type ListLeadFormsInput = z.infer<typeof listLeadFormsSchema>;
