import { documentImport, withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray } from 'drizzle-orm';
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

export const clearDocumentImportsSchema = z.object({
  organizationId: z.string().min(1, 'Organization is required'),
});

export type ClearDocumentImportsInput = z.infer<
  typeof clearDocumentImportsSchema
>;

export type ClearStorageDeps = Pick<
  DocumentImportStorageDeps,
  'getOrgAssetsBucket' | 'deleteObject'
>;

/**
 * Statuses that represent FINISHED work, and nothing else.
 *
 * `matched` is done — the file already sits in the client's documents, so the
 * import row is only a receipt. `failed` is done too: it could not be read and
 * a person has seen why. Everything else is either outstanding (`needs_review`
 * is somebody's to-do) or still moving (`uploading`/`pending`/`processing`),
 * and clearing those would destroy work rather than tidy up after it.
 */
const SETTLED = ['matched', 'failed'] as const;

/**
 * Empty the import dialog of everything already dealt with (ENG-784).
 *
 * The list is append-only otherwise: every document ever imported stays on
 * screen, so the rows that need a decision end up buried under months of ones
 * that do not.
 *
 * Soft-delete only — the vault copies are untouched, so clearing loses no
 * client document. The staged objects behind `failed` rows are dropped
 * (nothing else will ever read them); `matched` rows have none left, since
 * finalizing moved the file and deleted the original.
 */
const clearDocumentImportsImpl = async (
  db: DbConnection,
  storage: ClearStorageDeps,
  input: ClearDocumentImportsInput
): Promise<Result<{ cleared: number }>> => {
  const parsed = clearDocumentImportsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { organizationId } = parsed.data;

  const scope = and(
    eq(documentImport.organizationId, organizationId),
    inArray(documentImport.status, [...SETTLED]),
    notDeleted(documentImport)
  );

  let cleared: (typeof documentImport.$inferSelect)[];
  try {
    cleared = await withOrgScope(
      (tx) =>
        tx
          .update(documentImport)
          .set({ deletedAt: new Date() })
          .where(scope)
          .returning(),
      { db }
    );
  } catch (error) {
    logError('documentImports.clearDocumentImports', error, {
      feature: 'document-imports',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to clear imported documents'
      )
    );
  }

  // Best effort, and deliberately not awaited into the response: the row is
  // already gone from the list, and a bucket hiccup should not fail the tidy-up.
  const bucket = storage.getOrgAssetsBucket();
  for (const row of cleared) {
    if (row.status !== 'failed') continue;
    storage
      .deleteObject({ bucket, key: row.storageKey })
      .catch((error: unknown) => {
        logError('documentImports.clearDocumentImports.cleanup', error, {
          feature: 'document-imports',
          extra: { organizationId, importId: row.id, key: row.storageKey },
        });
      });
  }

  return ok({ cleared: cleared.length });
};

export const clearDocumentImports = (
  db: DbConnection,
  storage: ClearStorageDeps,
  input: ClearDocumentImportsInput
) =>
  trackedResult(
    'documentImports.clearDocumentImports',
    () => clearDocumentImportsImpl(db, storage, input),
    { properties: { organizationId: input.organizationId } }
  );

export type ClearDocumentImportsResult = Awaited<
  ReturnType<typeof clearDocumentImports>
>;
