import { patientDocumentUploadedByValues } from '@borradh-workspace/labels';
import { z } from 'zod';
import { PATIENT_DOCUMENT_CONTENT_TYPES } from '../../../upload/index.js';
import { PATIENT_DOCUMENT_MAX_SIZE_BYTES } from '../presign-patient-document/presign-patient-document.schema.js';

export const createPatientDocumentSchema = z.object({
  organizationId: z.string().min(1, 'Organization is required'),
  leadId: z.string().min(1, 'Patient is required'),
  /**
   * The S3 key returned by the presign step. Must sit under this
   * org/patient's `patient-documents/…` prefix — verified in the service so
   * a client can never record a blob it did not presign for this patient.
   */
  key: z.string().min(1, 'Upload key is required'),
  fileName: z.string().min(1, 'File name is required').max(255),
  mimeType: z.enum(PATIENT_DOCUMENT_CONTENT_TYPES, {
    message: 'Only PDF, JPEG, PNG, HEIC and WebP files are allowed',
  }),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(PATIENT_DOCUMENT_MAX_SIZE_BYTES, 'File is too large (max 15MB)'),
  uploadedByType: z.enum(patientDocumentUploadedByValues),
  /** Staff user id when uploadedByType is 'staff'. */
  uploadedByUserId: z.string().min(1).optional(),
});

export type CreatePatientDocumentInput = z.infer<
  typeof createPatientDocumentSchema
>;
