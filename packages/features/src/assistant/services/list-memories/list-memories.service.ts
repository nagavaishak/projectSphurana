import {
  and,
  desc,
  eq,
  isNull,
  knowledgeEntry,
  or,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { count } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListMemoriesInput,
  type ListMemoriesOutput,
  listMemoriesSchema,
} from './list-memories.schema.js';

const DEFAULT_LIMIT = 50;
const DEFAULT_OFFSET = 0;
const DEFAULT_TYPE = 'preference';

/**
 * List user-managed memories for the C-14 settings page.
 *
 * Scope:
 *   - Org: hard filter on `organization_id`.
 *   - User: union of org-wide entries (`user_id IS NULL`) and the requesting
 *     user's personal entries (`user_id = $userId`). Other users' personal
 *     entries are never returned.
 *   - Type: defaults to `preference`. Conversation summaries + operational
 *     snapshots are internal populator output — the user shouldn't see (or
 *     edit/delete) them through the memories CRUD surface.
 *
 * Pagination: classic limit/offset; total count returned for client display.
 * Sort: `createdAt DESC`.
 *
 * Rows come back in the shape the settings page consumes: `scope` derived
 * from ownership, timestamps as ISO-8601 strings. Keeping that here (rather
 * than in the controller) means every caller sees one memory shape.
 */
const listMemoriesImpl = async (
  db: DbConnection,
  input: ListMemoriesInput
): Promise<Result<ListMemoriesOutput>> => {
  const parsed = listMemoriesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    userId,
    type = DEFAULT_TYPE,
    limit = DEFAULT_LIMIT,
    offset = DEFAULT_OFFSET,
  } = parsed.data;

  const whereClause = and(
    eq(knowledgeEntry.organizationId, organizationId),
    eq(knowledgeEntry.type, type),
    or(isNull(knowledgeEntry.userId), eq(knowledgeEntry.userId, userId))
  );

  try {
    const { items, total } = await withOrgScope(
      async (tx) => {
        const items = await tx
          .select({
            id: knowledgeEntry.id,
            organizationId: knowledgeEntry.organizationId,
            userId: knowledgeEntry.userId,
            type: knowledgeEntry.type,
            title: knowledgeEntry.title,
            content: knowledgeEntry.content,
            source: knowledgeEntry.source,
            confidence: knowledgeEntry.confidence,
            metadata: knowledgeEntry.metadata,
            createdAt: knowledgeEntry.createdAt,
            updatedAt: knowledgeEntry.updatedAt,
          })
          .from(knowledgeEntry)
          .where(whereClause)
          .orderBy(desc(knowledgeEntry.createdAt))
          .limit(limit)
          .offset(offset);

        const totalRows = await tx
          .select({ value: count() })
          .from(knowledgeEntry)
          .where(whereClause);

        return { items, total: Number(totalRows[0]?.value ?? 0) };
      },
      { db }
    );

    return ok({
      items: items.map((row) => ({
        id: row.id,
        organizationId: row.organizationId ?? organizationId,
        userId: row.userId,
        type: row.type,
        title: row.title,
        content: row.content,
        source: row.source,
        confidence: row.confidence,
        metadata: row.metadata,
        scope:
          row.userId === null
            ? ('organization' as const)
            : ('personal' as const),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      total,
      limit,
      offset,
    });
  } catch (error) {
    logError('assistant.listMemories', error, {
      feature: 'assistant',
      extra: { organizationId, userId, type },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to list memories')
    );
  }
};

export const listMemories = (db: DbConnection, input: ListMemoriesInput) =>
  trackedResult('assistant.listMemories', () => listMemoriesImpl(db, input), {
    properties: {
      organizationId: input.organizationId,
      userId: input.userId,
      type: input.type ?? DEFAULT_TYPE,
    },
    internalErrorsOnly: true,
  });

export type ListMemoriesResult = Awaited<ReturnType<typeof listMemories>>;
