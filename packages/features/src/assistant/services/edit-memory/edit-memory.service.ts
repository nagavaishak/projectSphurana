import { sql, withOrgScope } from '@borradh-workspace/database';
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
import { generateEmbedding } from '../../knowledge/embed.js';
import { validateGeneratedCopy } from '../generate-recommendation-payload/d2b-validator.js';
import {
  type EditMemoryInput,
  type EditMemoryOutput,
  editMemorySchema,
} from './edit-memory.schema.js';

/**
 * Filter the d2b validator failures down to the rules that should hard-block
 * a user-authored memory.
 *
 * Same set used by `summariseConversation` — keep them in lock-step. We
 * intentionally exclude `percent_claim` because bare percentages are
 * legitimate in memories ("we run 25% off promos in January"); the rules
 * we DO enforce are the ones that materially raise compliance risk if the
 * model later quotes the memory back inside ad copy:
 *   - `outcome_claim` — "60% reduction" / "3x improvement"
 *   - `banned_phrase` — guaranteed / proven / cure / etc.
 *   - `pom_brand` — POM brand names by case
 */
function filterMemoryHardBlocks(
  failures: ReturnType<typeof validateGeneratedCopy>
) {
  return failures.filter(
    (f) =>
      f.reason === 'outcome_claim' ||
      f.reason === 'banned_phrase' ||
      f.reason === 'pom_brand'
  );
}

/**
 * Edit a memory's content.
 *
 * Memory CRUD is restricted to `type: 'preference'` rows (claire.md §2 Q4 —
 * conversation summaries + operational snapshots are populator output, not
 * user-managed entries; surfacing them here would let a user mutate
 * snapshot prose mid-day with no audit trail).
 *
 * Authorization mirrors `deleteMemory`:
 *   - Personal entry → owner only.
 *   - Org-wide entry → org admin/owner only (via `checkAdminAccess`).
 *
 * On content change we **always re-embed** — saving a row whose embedding
 * doesn't match its content silently degrades retrieval. The re-embed cost
 * (~$0.00002 per memory) is trivial compared to the cost of a stale row
 * surfacing the wrong context. The pgvector HNSW index doesn't need any
 * post-write maintenance for a single-row update.
 *
 * Pre-write hard-blocks (defense in depth — same posture as `meta_remember`):
 *   - `validateGeneratedCopy` (filtered to outcome_claim / banned_phrase /
 *     pom_brand) runs against the new content before the embed call.
 *   - On failure we return `INVALID_INPUT` with the matched rule in the
 *     details so the controller can surface a clear refusal to the user.
 */
const editMemoryImpl = async (
  db: DbConnection,
  input: EditMemoryInput
): Promise<Result<EditMemoryOutput>> => {
  const parsed = editMemorySchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId, userId, content } = parsed.data;

  // Look up the existing row (org-scoped) to confirm it exists, capture its
  // ownership, and verify it's a `preference` row before doing anything else.
  let existing: { id: string; userId: string | null; type: string } | undefined;
  try {
    const rows = await withOrgScope(
      (tx) =>
        tx.execute<{
          id: string;
          user_id: string | null;
          type: string;
        }>(sql`
        SELECT id, user_id, type
        FROM knowledge_entry
        WHERE id = ${id} AND organization_id = ${organizationId}
        LIMIT 1
      `),
      { db }
    );
    const row = rows[0];
    if (row) {
      existing = { id: row.id, userId: row.user_id, type: row.type };
    }
  } catch (error) {
    logError('assistant.editMemory.lookup', error, {
      feature: 'assistant',
      extra: { id, organizationId, userId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to edit memory')
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
          'You do not have permission to edit this memory'
        )
      );
    }
  } else {
    const adminCheck = await checkAdminAccess(db, { userId, organizationId });
    if (!adminCheck.success || !adminCheck.data.hasAccess) {
      return err(
        new FeatureError(
          ErrorCodes.FORBIDDEN,
          'Only organization admins can edit shared memories'
        )
      );
    }
  }

  const failures = filterMemoryHardBlocks(validateGeneratedCopy({ content }));
  if (failures.length > 0) {
    const first = failures[0];
    return err(
      new FeatureError(
        ErrorCodes.INVALID_INPUT,
        `Memory contains content that would breach a safety rule (${first.reason}${first.matched ? `: "${first.matched}"` : ''}). Try rephrasing without specific brand names or absolute outcome claims.`,
        { failures }
      )
    );
  }

  let embeddingStr: string;
  try {
    const embedding = await generateEmbedding(content);
    embeddingStr = `[${embedding.join(',')}]`;
  } catch (error) {
    logError('assistant.editMemory.embed', error, {
      feature: 'assistant',
      extra: { id, organizationId, userId },
    });
    return err(
      new FeatureError(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        'Failed to generate embedding for memory'
      )
    );
  }

  try {
    const updated = await withOrgScope(
      (tx) =>
        tx.execute<{ id: string; updated_at: Date }>(sql`
        UPDATE knowledge_entry
        SET
          content = ${content},
          embedding = ${embeddingStr}::vector,
          updated_at = NOW()
        WHERE id = ${id} AND organization_id = ${organizationId}
        RETURNING id, updated_at
      `),
      { db }
    );

    const row = updated[0];
    if (!row) {
      // Lost a race against a parallel delete after authorization passed.
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Memory not found'));
    }

    return ok({
      knowledgeEntryId: row.id,
      content,
      updatedAt: (row.updated_at instanceof Date
        ? row.updated_at
        : new Date(row.updated_at)
      ).toISOString(),
    });
  } catch (error) {
    logError('assistant.editMemory.update', error, {
      feature: 'assistant',
      extra: { id, organizationId, userId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to edit memory')
    );
  }
};

export const editMemory = (db: DbConnection, input: EditMemoryInput) =>
  trackedResult('assistant.editMemory', () => editMemoryImpl(db, input), {
    properties: {
      id: input.id,
      organizationId: input.organizationId,
      userId: input.userId,
    },
    internalErrorsOnly: true,
  });

export type EditMemoryResult = Awaited<ReturnType<typeof editMemory>>;
