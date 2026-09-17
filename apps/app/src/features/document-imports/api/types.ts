import type {
  DocumentImportKind,
  DocumentImportMatchSource,
  DocumentImportStatus,
} from '@borradh-workspace/labels';

/**
 * Document import types (ENG-784).
 *
 * Serialized shape of `document_import` as returned by `document-imports`
 * — dates arrive as ISO strings. `matchedLeadName` is joined server-side so
 * the list never needs a second fetch per row.
 */
export interface DocumentImportCandidate {
  leadId: string;
  name: string;
  matchedOn: string[];
  score: number;
}

export interface DocumentImportExtracted {
  personName: string | null;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  dates: string[];
  summary: string | null;
}

export interface DocumentImportItem {
  id: string;
  organizationId: string;
  uploadedByUserId: string | null;
  fileName: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  status: DocumentImportStatus;
  documentKind: DocumentImportKind | null;
  matchedLeadId: string | null;
  matchedLeadName: string | null;
  matchSource: DocumentImportMatchSource | null;
  patientDocumentId: string | null;
  confidence: number | null;
  extracted: DocumentImportExtracted | null;
  candidates: DocumentImportCandidate[] | null;
  matchReason: string | null;
  failureReason: string | null;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface DocumentImportListResponse {
  items: DocumentImportItem[];
}

/** `POST document-imports/presign` response — single-PUT upload target. */
export interface PresignDocumentImportResponse {
  importId: string;
  url: string;
  key: string;
  expiresIn: number;
}

/** Mirrors the server cap (presign re-validates). */
export const DOCUMENT_IMPORT_MAX_SIZE_BYTES = 15 * 1024 * 1024;

/** How many files one drop may carry. */
export const DOCUMENT_IMPORT_MAX_FILES = 20;

/**
 * react-dropzone `accept` map. No HEIC: the matcher cannot read it (see the
 * server allow-list) — staff can still add a HEIC from the client's profile.
 */
export const DOCUMENT_IMPORT_ACCEPT: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
};

/**
 * Statuses the list keeps polling for. `uploading` is deliberately NOT one:
 * the browser PUT is the only thing that moves it on, and the upload hook
 * invalidates the list itself when it completes — so a row stuck in
 * `uploading` is an abandoned upload, not work in progress.
 */
export const IN_FLIGHT_STATUSES: ReadonlySet<DocumentImportStatus> = new Set([
  'pending',
  'processing',
]);

/** Statuses a person resolves by picking a client (or discarding). */
export const REVIEWABLE_STATUSES: ReadonlySet<DocumentImportStatus> = new Set([
  'needs_review',
  'failed',
]);

/** Statuses a person may discard. */
export const DISCARDABLE_STATUSES: ReadonlySet<DocumentImportStatus> = new Set([
  'needs_review',
  'failed',
  'uploading',
]);
