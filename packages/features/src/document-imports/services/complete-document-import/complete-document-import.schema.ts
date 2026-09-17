import { z } from 'zod';

export const completeDocumentImportSchema = z.object({
  organizationId: z.string().min(1, 'Organization is required'),
  importId: z.string().min(1, 'Import is required'),
});

export type CompleteDocumentImportInput = z.infer<
  typeof completeDocumentImportSchema
>;
