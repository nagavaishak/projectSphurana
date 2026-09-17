import {
  type DocumentImportMatchSource,
  documentImport,
  patientDocument,
} from '@borradh-workspace/database';
import { logError } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { createPatientDocument } from '../../../patient-documents/index.js';
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
  PATIENT_DOCUMENT_CONTENT_TYPES,
  buildPatientDocumentKey,
} from '../../../upload/index.js';
import {
  type DocumentImportStorageDeps,
  documentImportKeyPrefix,
} from '../../models/index.js';

export type FinalizeStorageDeps = Pick<
  DocumentImportStorageDeps,
  'getOrgAssetsBucket' | 'getS3Region' | 'getMetadata' | 'copy' | 'deleteObject'
>;

export interface FinalizeDocumentMatchInput {
  organizationId: string;
  importId: string;
  leadId: string;
  matchSource: DocumentImportMatchSource;
  confidence: number | null;
  reason: string | null;
  /** Staff user recorded as the vault uploader; defaults to the importer. */
  actorUserId?: string | null;
}

/**
 * Turn a staged import into a vault document (ENG-784). Shared by the
 * automatic matcher and manual assignment — the only difference is
 * `matchSource`.
 *
 *   1. copy  staging object → patient-documents/{org}/{lead}/…
 *   2. createPatientDocument (HeadObjects the copy, verifies lead ∈ org)
 *   3. mark the import matched, pointing at the new vault row
 *   4. delete the staging object (best effort — the row keeps the audit)
 *
 * Idempotent on `patientDocumentId`: a retried job or a double-click after
 * a slow first call returns the row as-is instead of copying twice.
 *
 * Every read and write here is scoped to a LIVE row (`deletedAt IS NULL`), so
 * an import discarded while the worker was mid-flight never lands in the
 * client's vault; if the discard wins the race after the copy, the vault row
 * and its object are rolled back.
 */
export const finalizeDocumentMatch = async (
  tx: DbConnection,
  storage: FinalizeStorageDeps,
  input: FinalizeDocumentMatchInput
): Promise<Result<typeof documentImport.$inferSelect>> => {
  const { organizationId, importId, leadId } = input;

  // `notDeleted` is the whole guard against the discard race: staff may
  // discard a row while the worker is still mid-flight on it (extraction and
  // adjudication together can run for a minute). Without this the worker
  // would happily finish afterwards and drop the file into the client's
  // vault even though a person just threw it away.
  const row = await tx.query.documentImport.findFirst({
    where: and(
      eq(documentImport.id, importId),
      eq(documentImport.organizationId, organizationId),
      notDeleted(documentImport)
    ),
  });
  if (!row) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Import not found'));
  }
  if (row.patientDocumentId) return ok(row);

  // Only ever copy out of this import's own staging folder.
  if (
    !row.storageKey.startsWith(
      documentImportKeyPrefix(organizationId, importId)
    )
  ) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Staged file does not belong to this import'
      )
    );
  }
  const mimeType =
    row.mimeType as (typeof PATIENT_DOCUMENT_CONTENT_TYPES)[number];
  if (
    !(PATIENT_DOCUMENT_CONTENT_TYPES as readonly string[]).includes(mimeType)
  ) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Staged file type is not allowed in the vault'
      )
    );
  }

  const bucket = storage.getOrgAssetsBucket();
  const destinationKey = buildPatientDocumentKey(
    organizationId,
    leadId,
    row.fileName,
    mimeType
  );

  try {
    await storage.copy({
      sourceBucket: bucket,
      sourceKey: row.storageKey,
      destinationBucket: bucket,
      destinationKey,
    });
  } catch (error) {
    logError('documentImports.finalizeDocumentMatch.copy', error, {
      feature: 'document-imports',
      extra: { organizationId, importId, leadId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Could not move the file into the client’s documents'
      )
    );
  }

  const created = await createPatientDocument(tx, storage, {
    organizationId,
    leadId,
    key: destinationKey,
    fileName: row.fileName,
    mimeType,
    sizeBytes: row.sizeBytes,
    uploadedByType: 'staff',
    uploadedByUserId: input.actorUserId ?? row.uploadedByUserId ?? undefined,
  });
  if (!created.success) {
    await storage
      .deleteObject({ bucket, key: destinationKey })
      .catch(() => undefined);
    return err(
      new FeatureError(
        created.error.code,
        created.error.message,
        created.error.details
      )
    );
  }

  let updated: typeof documentImport.$inferSelect | undefined;
  try {
    [updated] = await tx
      .update(documentImport)
      .set({
        status: 'matched',
        matchedLeadId: leadId,
        matchSource: input.matchSource,
        confidence: input.confidence,
        matchReason: input.reason,
        patientDocumentId: created.data.id,
        failureReason: null,
        processedAt: new Date(),
      })
      .where(
        and(
          eq(documentImport.id, importId),
          eq(documentImport.organizationId, organizationId),
          notDeleted(documentImport)
        )
      )
      .returning();
  } catch (error) {
    logError('documentImports.finalizeDocumentMatch.update', error, {
      feature: 'document-imports',
      extra: { organizationId, importId, leadId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to record the match')
    );
  }
  if (!updated) {
    // Discarded between the lookup and this write. The vault row and its
    // object were created moments ago and nobody has seen them, so undo both
    // rather than leaving an orphan in the client's documents.
    try {
      await tx
        .delete(patientDocument)
        .where(
          and(
            eq(patientDocument.id, created.data.id),
            eq(patientDocument.organizationId, organizationId)
          )
        );
    } catch (error) {
      logError('documentImports.finalizeDocumentMatch.rollback', error, {
        feature: 'document-imports',
        extra: { organizationId, importId, documentId: created.data.id },
      });
    }
    await storage
      .deleteObject({ bucket, key: destinationKey })
      .catch(() => undefined);
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Import not found'));
  }

  storage.deleteObject({ bucket, key: row.storageKey }).catch((error) => {
    logError('documentImports.finalizeDocumentMatch.cleanup', error, {
      feature: 'document-imports',
      extra: { organizationId, importId, key: row.storageKey },
    });
  });

  return ok(updated);
};
