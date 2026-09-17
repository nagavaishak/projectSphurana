import { randomUUID } from 'node:crypto';
import type {
  DocumentImportCandidate,
  DocumentImportExtracted,
  DocumentImportKind,
} from '@borradh-workspace/database';
import type {
  copy as CopyFn,
  deleteObject as DeleteObjectFn,
  downloadAsBuffer as DownloadAsBufferFn,
  getMetadata as GetMetadataFn,
  getOrgAssetsBucket as GetOrgAssetsBucketFn,
  getPresignedUploadUrl as GetPresignedUploadUrlFn,
  getS3Region as GetS3RegionFn,
} from '@borradh-workspace/storage';

/**
 * Files the bulk importer accepts. A strict SUBSET of the vault's
 * `PATIENT_DOCUMENT_CONTENT_TYPES`: HEIC is left out because neither sharp's
 * prebuilt libvips nor the vision endpoint can decode it, and a file the
 * matcher cannot read has no business in a flow whose whole point is reading.
 * (Staff can still drop a HEIC straight into a client's vault.)
 */
export const DOCUMENT_IMPORT_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type DocumentImportContentType =
  (typeof DOCUMENT_IMPORT_CONTENT_TYPES)[number];

/** Same cap as the vault — the file ends up there. */
export const DOCUMENT_IMPORT_MAX_SIZE_BYTES = 15 * 1024 * 1024;

/** Presigned PUT URLs live this long. */
export const DOCUMENT_IMPORT_UPLOAD_EXPIRES_SECONDS = 15 * 60;

/** Root prefix of staged objects in the private org-assets bucket. */
export const DOCUMENT_IMPORT_KEY_PREFIX = 'document-imports';

/**
 * Below this the matcher will not attach automatically — the row goes to
 * needs_review with the model's best guess shown to a person.
 */
export const AUTO_MATCH_CONFIDENCE_THRESHOLD = 0.85;

const MIME_EXTENSIONS: Record<DocumentImportContentType, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const documentImportExtension = (
  contentType: DocumentImportContentType
): string => MIME_EXTENSIONS[contentType];

/**
 * Staged-object key. Lives under the import id (not a lead id — there is
 * none yet) so `finalize` can verify it is copying from its own staging
 * folder and nothing else.
 */
export const buildDocumentImportKey = (
  organizationId: string,
  importId: string,
  contentType: DocumentImportContentType
): string =>
  `${DOCUMENT_IMPORT_KEY_PREFIX}/${organizationId}/${importId}/${Date.now()}-${randomUUID().slice(0, 8)}.${documentImportExtension(contentType)}`;

export const documentImportKeyPrefix = (
  organizationId: string,
  importId: string
): string => `${DOCUMENT_IMPORT_KEY_PREFIX}/${organizationId}/${importId}/`;

/** Storage functions the services need — injected so tests never touch S3. */
export interface DocumentImportStorageDeps {
  getOrgAssetsBucket: typeof GetOrgAssetsBucketFn;
  getS3Region: typeof GetS3RegionFn;
  getPresignedUploadUrl: typeof GetPresignedUploadUrlFn;
  getMetadata: typeof GetMetadataFn;
  downloadAsBuffer: typeof DownloadAsBufferFn;
  copy: typeof CopyFn;
  deleteObject: typeof DeleteObjectFn;
}

/**
 * Turning bytes into something the vision model can read. The real
 * implementation (`media/`) loads pdfjs + canvas + sharp lazily; tests and
 * the service layer only ever see this interface.
 */
export interface DocumentMediaDeps {
  /** Text layer of the first `maxPages` pages, joined. Empty for scans. */
  extractPdfText(bytes: Buffer, maxPages: number): Promise<string>;
  /** First `maxPages` pages rasterised to JPEG. */
  renderPdfPages(
    bytes: Buffer,
    options: { maxPages: number; scale: number }
  ): Promise<Buffer[]>;
  /** Downscale + re-encode a photo so the request stays small. */
  prepareImage(
    bytes: Buffer,
    mimeType: string
  ): Promise<{ base64: string; mimeType: string }>;
}

/** What `extractDocumentFields` hands to the matcher. */
export interface ExtractedDocument extends DocumentImportExtracted {
  documentKind: DocumentImportKind;
  /** False when the model could not read the content at all. */
  legible: boolean;
}

/** A candidate as the retrieval step sees it (richer than what is persisted). */
export interface LeadCandidate extends DocumentImportCandidate {
  email: string | null;
  phone: string | null;
  /** ISO dates of the most recent appointments, newest first. */
  lastAppointments: string[];
}

/** The model's pick among the candidates. */
export interface MatchDecision {
  leadId: string | null;
  confidence: number;
  reason: string;
}

export type ProcessDocumentImportOutcome =
  | 'matched'
  | 'needs_review'
  | 'failed'
  | 'skipped';
