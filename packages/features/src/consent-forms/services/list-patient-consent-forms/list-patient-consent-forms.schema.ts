import { consentFormSubmissionStatusValues } from '@borradh-workspace/labels';
import { z } from 'zod';

export const listPatientConsentFormsSchema = z.object({
  /** The signed-in patient's lead.id — from the VALIDATED session, never the client. */
  leadId: z.string().min(1, 'Lead ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  status: z.enum(consentFormSubmissionStatusValues).optional(),
});

export type ListPatientConsentFormsInput = z.infer<
  typeof listPatientConsentFormsSchema
>;
