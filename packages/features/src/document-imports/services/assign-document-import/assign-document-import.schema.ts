import { z } from 'zod';

export const assignDocumentImportSchema = z.object({
  organizationId: z.string().min(1, 'Organization is required'),
  importId: z.string().min(1, 'Import is required'),
  leadId: z.string().min(1, 'Client is required'),
  /** Staff user making the call — recorded as the vault uploader. */
  actorUserId: z.string().min(1, 'User is required'),
});

export type AssignDocumentImportInput = z.infer<
  typeof assignDocumentImportSchema
>;
