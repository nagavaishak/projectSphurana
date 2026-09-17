import { documentImport, withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import type { DocumentImportStorageDeps } from '../../models/index.js';

export const discardDocumentImportSchema = z.object({
  organizationId: z.string().min(1, 'Organization is required'),
  importId: z.string().min(1, 'Import is required'),
});

export type DiscardDocumentImportInput = z.infer<
  typeof discardDocumentImportSchema
>;

export type DiscardStorageDeps = Pick<
  DocumentImportStorageDeps,
  'getOrgAssetsBucket' | 'deleteObject'
>;

/**
 * Staff decide not to keep a staged file (ENG-784): soft-delete the row and
 * drop the object. A matched import cannot be discarded here — its file now
 * lives in the client's vault, and removing it from there is the vault's
 * (admin-only) delete.
 */
const discardDocumentImportImpl = async (
  db: DbConnection,
  storage: DiscardStorageDeps,
  input: DiscardDocumentImportInput
): Promise<Result<{ success: true }>> => {
  const parsed = discardDocumentImportSchema.safeParse(input);
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
  if (row.status === 'matched') {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'This document is already in the client’s documents — delete it from there instead'
      )
    );
  }

  try {
    await withOrgScope(
      (tx) =>
        tx
          .update(documentImport)
          .set({ status: 'discarded', deletedAt: new Date() })
          .where(
            and(
              eq(documentImport.id, importId),
              eq(documentImport.organizationId, organizationId)
            )
          ),
      { db }
    );
  } catch (error) {
    logError('documentImports.discardDocumentImport', error, {
      feature: 'document-imports',
      extra: { organizationId, importId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to discard document')
    );
  }

  storage
    .deleteObject({ bucket: storage.getOrgAssetsBucket(), key: row.storageKey })
    .catch((error) => {
      logError('documentImports.discardDocumentImport.cleanup', error, {
        feature: 'document-imports',
        extra: { organizationId, importId, key: row.storageKey },
      });
    });

  return ok({ success: true });
};

export const discardDocumentImport = (
  db: DbConnection,
  storage: DiscardStorageDeps,
  input: DiscardDocumentImportInput
) =>
  trackedResult(
    'documentImports.discardDocumentImport',
    () => discardDocumentImportImpl(db, storage, input),
    {
      properties: {
        organizationId: input.organizationId,
        importId: input.importId,
      },
    }
  );

export type DiscardDocumentImportResult = Awaited<
  ReturnType<typeof discardDocumentImport>
>;
