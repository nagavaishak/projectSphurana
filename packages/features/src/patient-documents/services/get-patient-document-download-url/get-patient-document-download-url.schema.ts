import { z } from 'zod';

export const getPatientDocumentDownloadUrlSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  leadId: z.string().min(1, 'Lead ID is required'),
  documentId: z.string().min(1, 'Document ID is required'),
});

export type GetPatientDocumentDownloadUrlInput = z.infer<
  typeof getPatientDocumentDownloadUrlSchema
>;
