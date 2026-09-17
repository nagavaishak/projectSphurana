import { z } from 'zod';
import { PATIENT_DOCUMENT_CONTENT_TYPES } from '../../../upload/index.js';

/** v1 hard cap — single-PUT uploads only, no multipart machinery. */
export const PATIENT_DOCUMENT_MAX_SIZE_BYTES = 15 * 1024 * 1024;

export const presignPatientDocumentSchema = z.object({
  organizationId: z.string().min(1, 'Organization is required'),
  leadId: z.string().min(1, 'Patient is required'),
  /**
   * Who is asking for the URL — the patient's leadId (portal) or the staff
   * user's id (dashboard). Only used for tracking; the key is scoped by
   * organizationId/leadId, not the uploader.
   */
  uploaderId: z.string().min(1),
  fileName: z.string().min(1, 'File name is required').max(255),
  mimeType: z.enum(PATIENT_DOCUMENT_CONTENT_TYPES, {
    message: 'Only PDF, JPEG, PNG, HEIC and WebP files are allowed',
  }),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(PATIENT_DOCUMENT_MAX_SIZE_BYTES, 'File is too large (max 15MB)'),
});

export type PresignPatientDocumentInput = z.infer<
  typeof presignPatientDocumentSchema
>;
