import { documentImport, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
} from '../../../shared/index.js';
import {
  type FinalizeStorageDeps,
  finalizeDocumentMatch,
} from '../finalize-document-match/index.js';
import {
  type AssignDocumentImportInput,
  assignDocumentImportSchema,
} from './assign-document-import.schema.js';

/** States a person may resolve by hand. */
const ASSIGNABLE = new Set(['needs_review', 'failed']);

/**
 * Staff pick the client for an import the matcher declined (ENG-784).
 * Restricted to `needs_review`/`failed` so a manual pick can never race the
 * worker on a row it is still reading.
 */
const assignDocumentImportImpl = async (
  db: DbConnection,
  storage: FinalizeStorageDeps,
  input: AssignDocumentImportInput
): Promise<Result<typeof documentImport.$inferSelect>> => {
  const parsed = assignDocumentImportSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { organizationId, importId, leadId, actorUserId } = parsed.data;

  return withOrgScope(
    async (tx) => {
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
      if (row.status === 'matched') {
        return err(
          new FeatureError(
            ErrorCodes.CONFLICT,
            'This document is already attached to a client'
          )
        );
      }
      if (!ASSIGNABLE.has(row.status)) {
        return err(
          new FeatureError(
            ErrorCodes.CONFLICT,
            'This document is still being read — try again in a moment'
          )
        );
      }
      return finalizeDocumentMatch(tx, storage, {
        organizationId,
        importId,
        leadId,
        matchSource: 'manual',
        confidence: null,
        reason: 'Assigned by staff',
        actorUserId,
      });
    },
    { db }
  );
};

export const assignDocumentImport = (
  db: DbConnection,
  storage: FinalizeStorageDeps,
  input: AssignDocumentImportInput
) =>
  trackedResult(
    'documentImports.assignDocumentImport',
    () => assignDocumentImportImpl(db, storage, input),
    {
      properties: {
        organizationId: input.organizationId,
        importId: input.importId,
        leadId: input.leadId,
      },
    }
  );

export type AssignDocumentImportResult = Awaited<
  ReturnType<typeof assignDocumentImport>
>;
