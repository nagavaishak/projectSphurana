import { z } from 'zod';

/** Portal variant: the lead/org ids come from the VALIDATED patient session. */
export const getConsentPdfDownloadForPatientSchema = z.object({
  submissionId: z.string().min(1, 'Submission ID is required'),
  leadId: z.string().min(1, 'Lead ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GetConsentPdfDownloadForPatientInput = z.infer<
  typeof getConsentPdfDownloadForPatientSchema
>;

/** Staff variant: the org id comes from the active-organization session. */
export const getConsentPdfDownloadForStaffSchema = z.object({
  submissionId: z.string().min(1, 'Submission ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GetConsentPdfDownloadForStaffInput = z.infer<
  typeof getConsentPdfDownloadForStaffSchema
>;
