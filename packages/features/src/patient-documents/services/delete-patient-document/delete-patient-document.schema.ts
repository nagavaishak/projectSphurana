import { z } from 'zod';

export const deletePatientDocumentSchema = z.object({
  organizationId: z.string().min(1, 'Organization is required'),
  /** The route's lead — the document must belong to it, so the URL can't
   * name one patient while deleting another's file (audit correctness). */
  leadId: z.string().min(1, 'Lead is required'),
  documentId: z.string().min(1, 'Document is required'),
});

export type DeletePatientDocumentInput = z.infer<
  typeof deletePatientDocumentSchema
>;
