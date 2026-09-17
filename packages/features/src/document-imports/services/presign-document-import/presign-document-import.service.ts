import { randomUUID } from 'node:crypto';
import { documentImport, withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  DOCUMENT_IMPORT_UPLOAD_EXPIRES_SECONDS,
  type DocumentImportStorageDeps,
  buildDocumentImportKey,
} from '../../models/index.js';
import {
  type PresignDocumentImportInput,
  presignDocumentImportSchema,
} from './presign-document-import.schema.js';

export interface PresignedDocumentImport {
  importId: string;
  /** Presigned PUT URL — upload the file bytes here directly. */
  url: string;
  /** Staged key under document-imports/{orgId}/{importId}/. */
  key: string;
  expiresIn: number;
}

export type PresignStorageDeps = Pick<
  DocumentImportStorageDeps,
  'getOrgAssetsBucket' | 'getPresignedUploadUrl'
>;

/**
 * Start a document import: create the staging row and mint a single-PUT
 * upload URL for it (ENG-784).
 *
 * The row is created FIRST, in `uploading`, so the key can embed the import
 * id and the `complete` step later verifies the row's OWN key — the client
 * never gets to name an object. Abandoned uploads stay visible as
 * `uploading` rows rather than silently littering the bucket.
 */
const presignDocumentImportImpl = async (
  db: DbConnection,
  storage: PresignStorageDeps,
  input: PresignDocumentImportInput
): Promise<Result<PresignedDocumentImport>> => {
  const parsed = presignDocumentImportSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, uploaderId, fileName, mimeType, sizeBytes } =
    parsed.data;
  const importId = randomUUID();
  const key = buildDocumentImportKey(organizationId, importId, mimeType);

  try {
    await withOrgScope(
      (tx) =>
        tx.insert(documentImport).values({
          id: importId,
          organizationId,
          uploadedByUserId: uploaderId,
          fileName,
          storageKey: key,
          mimeType,
          sizeBytes,
          status: 'uploading',
        }),
      { db }
    );

    const url = await storage.getPresignedUploadUrl({
      bucket: storage.getOrgAssetsBucket(),
      key,
      expiresIn: DOCUMENT_IMPORT_UPLOAD_EXPIRES_SECONDS,
      contentType: mimeType,
      // Signing the length makes S3 enforce the 15MB cap; the zod max above
      // only checks the client's claim.
      contentLength: sizeBytes,
    });

    return ok({
      importId,
      url,
      key,
      expiresIn: DOCUMENT_IMPORT_UPLOAD_EXPIRES_SECONDS,
    });
  } catch (error) {
    logError('documentImports.presignDocumentImport', error, {
      feature: 'document-imports',
      extra: { organizationId, importId, mimeType },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to start the document upload'
      )
    );
  }
};

export const presignDocumentImport = (
  db: DbConnection,
  storage: PresignStorageDeps,
  input: PresignDocumentImportInput
) =>
  trackedResult(
    'documentImports.presignDocumentImport',
    () => presignDocumentImportImpl(db, storage, input),
    {
      properties: {
        organizationId: input.organizationId,
        mimeType: input.mimeType,
      },
    }
  );

export type PresignDocumentImportResult = Awaited<
  ReturnType<typeof presignDocumentImport>
>;
