import { z } from 'zod';

export const listPatientDocumentsSchema = z.object({
  organizationId: z.string().min(1, 'Organization is required'),
  leadId: z.string().min(1, 'Patient is required'),
});

export type ListPatientDocumentsInput = z.infer<
  typeof listPatientDocumentsSchema
>;
