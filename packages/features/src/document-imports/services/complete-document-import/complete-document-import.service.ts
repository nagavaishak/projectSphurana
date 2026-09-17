import { documentImport, withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { documentMatchJob, enqueueJob } from '../../../jobs/index.js';
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
  DOCUMENT_IMPORT_CONTENT_TYPES,
  type DocumentImportStorageDeps,
} from '../../models/index.js';
import {
  type CompleteDocumentImportInput,
  completeDocumentImportSchema,
} from './complete-document-import.schema.js';

export type CompleteStorageDeps = Pick<
  DocumentImportStorageDeps,
  'getOrgAssetsBucket' | 'getMetadata'
>;

/**
 * The browser finished its PUT: verify the object landed, trust S3's observed
 * size/type over the presign claim, flip the row to `pending` and queue the
 * matcher (ENG-784).
 *
 * Idempotent: a row that has already left `uploading` is returned as-is, so
 * a double-click or a retried request cannot enqueue twice. The enqueue
 * happens OUTSIDE the scoped transaction so the worker can never observe a
 * row that is still `uploading`.
 */
const completeDocumentImportImpl = async (
  db: DbConnection,
  storage: CompleteStorageDeps,
  input: CompleteDocumentImportInput
): Promise<Result<typeof documentImport.$inferSelect>> => {
  const parsed = completeDocumentImportSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { organizationId, importId } = parsed.data;

  const row = await withOrgScope(
    (tx) =>
      tx.query.documentImport.findFirst({
        where: and(
          eq(documentImport.id, importId),
          eq(documentImport.organizationId, organizationId),
          notDeleted(documentImport)
        ),
      }),
    { db }
  );
  if (!row) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Import not found'));
  }
  if (row.status !== 'uploading') return ok(row);

  const bucket = storage.getOrgAssetsBucket();
  const metadata = await storage.getMetadata({ bucket, key: row.storageKey });
  if (!metadata) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Upload not found — the file was not stored'
      )
    );
  }

  const observedType = metadata.contentType ?? row.mimeType;
  const typeAllowed = (
    DOCUMENT_IMPORT_CONTENT_TYPES as readonly string[]
  ).includes(observedType);

  let updated: typeof documentImport.$inferSelect | undefined;
  try {
    [updated] = await withOrgScope(
      (tx) =>
        tx
          .update(documentImport)
          .set(
            typeAllowed
              ? {
                  status: 'pending',
                  mimeType: observedType,
                  sizeBytes: metadata.size ?? row.sizeBytes,
                }
              : {
                  status: 'failed',
                  failureReason: 'Uploaded file type is not allowed',
                  processedAt: new Date(),
                }
          )
          .where(
            and(
              eq(documentImport.id, importId),
              eq(documentImport.organizationId, organizationId)
            )
          )
          .returning(),
      { db }
    );
  } catch (error) {
    logError('documentImports.completeDocumentImport', error, {
      feature: 'document-imports',
      extra: { organizationId, importId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to record upload')
    );
  }
  if (!updated) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Import not found'));
  }
  if (!typeAllowed) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Uploaded file type is not allowed'
      )
    );
  }

  try {
    await enqueueJob(documentMatchJob, { organizationId, importId });
  } catch (error) {
    logError('documentImports.completeDocumentImport.enqueue', error, {
      feature: 'document-imports',
      extra: { organizationId, importId },
    });
    // The bytes are safe and the row says `pending`; a person can still
    // assign it by hand from the review list. Say so rather than pretend.
    await withOrgScope(
      (tx) =>
        tx
          .update(documentImport)
          .set({
            status: 'failed',
            failureReason: 'Could not queue the document for matching',
            processedAt: new Date(),
          })
          .where(eq(documentImport.id, importId)),
      { db }
    ).catch(() => undefined);
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Could not queue the document for matching'
      )
    );
  }

  return ok(updated);
};

export const completeDocumentImport = (
  db: DbConnection,
  storage: CompleteStorageDeps,
  input: CompleteDocumentImportInput
) =>
  trackedResult(
    'documentImports.completeDocumentImport',
    () => completeDocumentImportImpl(db, storage, input),
    {
      properties: {
        organizationId: input.organizationId,
        importId: input.importId,
      },
    }
  );

export type CompleteDocumentImportResult = Awaited<
  ReturnType<typeof completeDocumentImport>
>;
