import { documentImportKindValues } from '@borradh-workspace/labels';
import { z } from 'zod';

/**
 * Lenient on purpose: a model reply with one odd field should degrade to
 * "unknown" for that field, not throw the whole document into `failed`.
 */
export const extractedDocumentSchema = z.object({
  documentKind: z.enum(documentImportKindValues).catch('other'),
  personName: z.string().trim().min(1).nullable().catch(null),
  email: z.string().trim().toLowerCase().email().nullable().catch(null),
  phone: z.string().trim().min(5).nullable().catch(null),
  dateOfBirth: z.string().trim().min(4).nullable().catch(null),
  dates: z.array(z.string().trim().min(4)).catch([]),
  summary: z.string().trim().max(300).nullable().catch(null),
  legible: z.boolean().catch(true),
});

export const extractDocumentFieldsInputSchema = z.object({
  organizationId: z.string().min(1),
  importId: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
});

export type ExtractDocumentFieldsInput = z.infer<
  typeof extractDocumentFieldsInputSchema
> & { bytes: Buffer };
