import {
  patientDocument,
  withOrgScope,
  withPatientScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type GetPatientDocumentDownloadUrlInput,
  getPatientDocumentDownloadUrlSchema,
} from './get-patient-document-download-url.schema.js';

/** Presigned GETs are short-lived: enough to open/save, useless if leaked. */
const DOWNLOAD_URL_TTL_SECONDS = 300;

export interface PatientDocumentDownloadStorageDeps {
  getOrgAssetsBucket: () => string;
  getPresignedDownloadUrl: (options: {
    bucket?: string;
    key: string;
    expiresIn?: number;
    responseContentType?: string;
    responseContentDisposition?: string;
  }) => Promise<string>;
  attachmentDisposition: (fileName: string) => string;
}

export interface PatientDocumentDownloadUrl {
  url: string;
  expiresIn: number;
  fileName: string;
  mimeType: string;
}

/**
 * Extract the S3 key from a stored blobUrl and verify it sits under this
 * patient's own prefix. The row was already scoped to org+lead when fetched;
 * this is defense-in-depth against a corrupted/legacy blobUrl ever pointing
 * a presign outside the patient's directory.
 */
function extractVerifiedKey(
  blobUrl: string,
  organizationId: string,
  leadId: string
): string | null {
  let pathname: string;
  try {
    pathname = new URL(blobUrl).pathname;
  } catch {
    return null;
  }
  const key = pathname.replace(/^\//, '');
  const requiredPrefix = `patient-documents/${organizationId}/${leadId}/`;
  return key.startsWith(requiredPrefix) ? key : null;
}

const buildDownloadUrl = async (
  storage: PatientDocumentDownloadStorageDeps,
  doc: typeof patientDocument.$inferSelect,
  input: GetPatientDocumentDownloadUrlInput
): Promise<Result<PatientDocumentDownloadUrl>> => {
  const key = extractVerifiedKey(
    doc.blobUrl,
    input.organizationId,
    input.leadId
  );
  if (!key) {
    // A row whose blobUrl escapes the patient's prefix is a data-integrity
    // problem, not a user error — log loudly, fail closed.
    logError(
      'patientDocuments.getDownloadUrl',
      new Error('blobUrl outside patient prefix'),
      {
        feature: 'patient-documents',
        extra: { documentId: doc.id, organizationId: input.organizationId },
      }
    );
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Document unavailable')
    );
  }

  // Force a download with a neutral content-type. Patient documents are
  // arbitrary uploaded bytes — serving them inline with their stored (i.e.
  // attacker-chosen) content-type would let a `text/html` upload execute as
  // stored XSS in whoever opens it (staff or the patient). `attachment` +
  // octet-stream neutralises that regardless of what was stored.
  const url = await storage.getPresignedDownloadUrl({
    bucket: storage.getOrgAssetsBucket(),
    key,
    expiresIn: DOWNLOAD_URL_TTL_SECONDS,
    responseContentType: 'application/octet-stream',
    responseContentDisposition: storage.attachmentDisposition(doc.fileName),
  });

  return ok({
    url,
    expiresIn: DOWNLOAD_URL_TTL_SECONDS,
    fileName: doc.fileName,
    mimeType: doc.mimeType,
  });
};

const fetchDocument = async (
  tx: DbConnection,
  input: GetPatientDocumentDownloadUrlInput
) =>
  tx.query.patientDocument.findFirst({
    where: and(
      eq(patientDocument.id, input.documentId),
      eq(patientDocument.organizationId, input.organizationId),
      eq(patientDocument.leadId, input.leadId),
      notDeleted(patientDocument)
    ),
  });

/**
 * Portal variant: ownership proven under `withPatientScope` — the
 * patient-self RLS policy makes any other patient's row invisible, so a
 * guessed documentId resolves to NOT_FOUND before any URL is minted.
 */
export const getPatientDocumentDownloadUrlForPatient = (
  db: DbConnection,
  storage: PatientDocumentDownloadStorageDeps,
  input: GetPatientDocumentDownloadUrlInput
) =>
  trackedResult(
    'patientDocuments.getDownloadUrlForPatient',
    async () => {
      const parsed = getPatientDocumentDownloadUrlSchema.safeParse(input);
      if (!parsed.success) {
        return err(
          new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
            issues: parsed.error.issues,
          })
        );
      }
      return withPatientScope(
        {
          leadId: parsed.data.leadId,
          organizationId: parsed.data.organizationId,
        },
        async (tx) => {
          const doc = await fetchDocument(tx, parsed.data);
          if (!doc) {
            return err(
              new FeatureError(ErrorCodes.NOT_FOUND, 'Document not found')
            );
          }
          return buildDownloadUrl(storage, doc, parsed.data);
        },
        { db }
      );
    },
    {
      properties: { documentId: input.documentId },
      internalErrorsOnly: true,
    }
  );

/** Staff variant: org-scoped; any staff member of the org may download. */
export const getPatientDocumentDownloadUrlForStaff = (
  db: DbConnection,
  storage: PatientDocumentDownloadStorageDeps,
  input: GetPatientDocumentDownloadUrlInput
) =>
  trackedResult(
    'patientDocuments.getDownloadUrlForStaff',
    async () => {
      const parsed = getPatientDocumentDownloadUrlSchema.safeParse(input);
      if (!parsed.success) {
        return err(
          new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
            issues: parsed.error.issues,
          })
        );
      }
      return withOrgScope(
        async (tx) => {
          const doc = await fetchDocument(tx, parsed.data);
          if (!doc) {
            return err(
              new FeatureError(ErrorCodes.NOT_FOUND, 'Document not found')
            );
          }
          return buildDownloadUrl(storage, doc, parsed.data);
        },
        { db }
      );
    },
    {
      properties: { documentId: input.documentId },
      internalErrorsOnly: true,
    }
  );
