import {
  and,
  eq,
  knowledgeEntry,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { checkAdminAccess } from '../../../organizations/services/check-admin-access/check-admin-access.service.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type DeleteMemoryInput,
  type DeleteMemoryOutput,
  deleteMemorySchema,
} from './delete-memory.schema.js';

/**
 * Delete a memory entry.
 *
 * Memory CRUD is restricted to `type: 'preference'` rows (claire.md §2 Q4 —
 * conversation summaries + operational snapshots are internal populator
 * output and must not be deletable through this endpoint, otherwise an
 * operator could nuke the nightly snapshot mid-day).
 *
 * Authorization:
 *   - Entry not found in this org → NOT_FOUND.
 *   - Type !== 'preference' → NOT_FOUND (we don't acknowledge non-CRUD types).
 *   - Personal entry where `entry.user_id !== $userId` → FORBIDDEN.
 *   - Org-wide entry where caller is not admin/owner → FORBIDDEN.
 *   - Otherwise → DELETE the row.
 */
const deleteMemoryImpl = async (
  db: DbConnection,
  input: DeleteMemoryInput
): Promise<Result<DeleteMemoryOutput>> => {
  const parsed = deleteMemorySchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId, userId } = parsed.data;

  let existing: { id: string; userId: string | null; type: string } | undefined;
  try {
    const rows = await withOrgScope(
      (tx) =>
        tx
          .select({
            id: knowledgeEntry.id,
            userId: knowledgeEntry.userId,
            type: knowledgeEntry.type,
          })
          .from(knowledgeEntry)
          .where(
            and(
              eq(knowledgeEntry.id, id),
              eq(knowledgeEntry.organizationId, organizationId)
            )
          )
          .limit(1),
      { db }
    );
    existing = rows[0];
  } catch (error) {
    logError('assistant.deleteMemory.lookup', error, {
      feature: 'assistant',
      extra: { id, organizationId, userId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to delete memory')
    );
  }

  if (!existing || existing.type !== 'preference') {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Memory not found'));
  }

  if (existing.userId !== null) {
    if (existing.userId !== userId) {
      return err(
        new FeatureError(
          ErrorCodes.FORBIDDEN,
          'You do not have permission to delete this memory'
        )
      );
    }
  } else {
    const adminCheck = await checkAdminAccess(db, { userId, organizationId });
    if (!adminCheck.success || !adminCheck.data.hasAccess) {
      return err(
        new FeatureError(
          ErrorCodes.FORBIDDEN,
          'Only organization admins can delete shared memories'
        )
      );
    }
  }

  try {
    const result = await withOrgScope(
      (tx) =>
        tx
          .delete(knowledgeEntry)
          .where(
            and(
              eq(knowledgeEntry.id, id),
              eq(knowledgeEntry.organizationId, organizationId)
            )
          )
          .returning({ id: knowledgeEntry.id }),
      { db }
    );

    if (!result.length) {
      // Lost a race against a parallel delete — treat as not found rather
      // than 500. The earlier lookup said it existed; by the time we got
      // here, someone else removed it.
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Memory not found'));
    }

    return ok({ deleted: true, knowledgeEntryId: result[0].id });
  } catch (error) {
    logError('assistant.deleteMemory.delete', error, {
      feature: 'assistant',
      extra: { id, organizationId, userId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to delete memory')
    );
  }
};

export const deleteMemory = (db: DbConnection, input: DeleteMemoryInput) =>
  trackedResult('assistant.deleteMemory', () => deleteMemoryImpl(db, input), {
    properties: {
      id: input.id,
      organizationId: input.organizationId,
      userId: input.userId,
    },
    internalErrorsOnly: true,
  });

export type DeleteMemoryResult = Awaited<ReturnType<typeof deleteMemory>>;
