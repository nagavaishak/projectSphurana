import { z } from 'zod';

export const listMetaLeadFormsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type ListMetaLeadFormsInput = z.infer<typeof listMetaLeadFormsSchema>;
