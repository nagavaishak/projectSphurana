import { documentImportStatusValues } from '@borradh-workspace/labels';
import { z } from 'zod';

export const listDocumentImportsSchema = z.object({
  organizationId: z.string().min(1, 'Organization is required'),
  /** Restrict to these statuses. Omit for everything that is not discarded. */
  status: z.array(z.enum(documentImportStatusValues)).optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export type ListDocumentImportsInput = z.input<
  typeof listDocumentImportsSchema
>;
