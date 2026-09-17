import { z } from 'zod';
import {
  DOCUMENT_IMPORT_CONTENT_TYPES,
  DOCUMENT_IMPORT_MAX_SIZE_BYTES,
} from '../../models/index.js';

export const presignDocumentImportSchema = z.object({
  organizationId: z.string().min(1, 'Organization is required'),
  /** Staff user starting the import — recorded as the uploader. */
  uploaderId: z.string().min(1, 'Uploader is required'),
  fileName: z.string().min(1, 'File name is required').max(255),
  mimeType: z.enum(DOCUMENT_IMPORT_CONTENT_TYPES, {
    message: 'Only PDF, JPEG, PNG and WebP files can be imported',
  }),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(DOCUMENT_IMPORT_MAX_SIZE_BYTES, 'File is too large (max 15MB)'),
});

export type PresignDocumentImportInput = z.infer<
  typeof presignDocumentImportSchema
>;
