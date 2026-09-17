import type { PatientDocumentUploadedBy } from '@borradh-workspace/labels';

/**
 * Patient document vault types (ENG-647 Phase 4).
 *
 * Serialized shape of `patient_document` as returned by both the patient
 * (`patient/documents`) and staff (`leads/:leadId/documents`) endpoints —
 * dates arrive as ISO strings.
 */
export interface PatientDocumentItem {
  id: string;
  organizationId: string;
  leadId: string;
  uploadedByType: PatientDocumentUploadedBy;
  uploadedByUserId: string | null;
  fileName: string;
  blobUrl: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  deletedAt: string | null;
}

export interface PatientDocumentListResponse {
  items: PatientDocumentItem[];
}

/** `POST …/presign` response — single-PUT upload target. */
export interface PresignPatientDocumentResponse {
  url: string;
  key: string;
  expiresIn: number;
}

/** Mirrors the server-side allowlist + 15MB cap (presign re-validates). */
export const PATIENT_DOCUMENT_MAX_SIZE_BYTES = 15 * 1024 * 1024;

/** react-dropzone `accept` map for the same allowlist. */
export const PATIENT_DOCUMENT_ACCEPT: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/heic': ['.heic'],
  'image/webp': ['.webp'],
};
