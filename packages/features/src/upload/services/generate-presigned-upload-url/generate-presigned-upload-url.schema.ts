import { z } from 'zod';

export const uploadTypeValues = ['image', 'video'] as const;
export type UploadType = (typeof uploadTypeValues)[number];

export const uploadPurposeValues = [
  'profile',
  'org-asset',
  'patient-document',
] as const;
export type UploadPurpose = (typeof uploadPurposeValues)[number];

/**
 * Content types a patient document (ENG-647 Phase 4) may be uploaded as.
 * Clinical files are images or PDFs only — no video, no arbitrary binaries.
 * HEIC is included because iPhone camera capture produces it by default.
 */
export const PATIENT_DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
] as const;

export const generatePresignedUploadUrlSchema = z.object({
  filename: z.string().min(1, 'Filename is required'),
  contentType: z.string().min(1, 'Content type is required'),
  type: z.enum(uploadTypeValues),
  purpose: z.enum(uploadPurposeValues).optional(),
  expiresIn: z.number().min(60).max(3600).optional(),
  userId: z.string().min(1),
  organizationId: z.string().optional(),
  /** Required when purpose is 'patient-document' — scopes the S3 key prefix. */
  leadId: z.string().optional(),
  /**
   * Exact byte count of the file to be uploaded. When supplied it is folded
   * into the signature, so S3 rejects a PUT of any other size — the only way a
   * caller's size limit actually binds. Omit when the size isn't known up
   * front.
   */
  contentLength: z.number().int().positive().optional(),
});

export type GeneratePresignedUploadUrlInput = z.infer<
  typeof generatePresignedUploadUrlSchema
>;
