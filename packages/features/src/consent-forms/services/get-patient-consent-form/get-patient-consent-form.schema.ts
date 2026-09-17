import { z } from 'zod';

export const getPatientConsentFormSchema = z.object({
  /** The signed-in patient's lead.id — from the VALIDATED session, never the client. */
  leadId: z.string().min(1, 'Lead ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  submissionId: z.string().min(1, 'Submission ID is required'),
});

export type GetPatientConsentFormInput = z.infer<
  typeof getPatientConsentFormSchema
>;
