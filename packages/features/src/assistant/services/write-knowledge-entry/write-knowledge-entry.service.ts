import { sql } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { generateEmbedding } from '../../knowledge/embed.js';
import {
  type WriteKnowledgeEntryInput,
  type WriteKnowledgeEntryOutput,
  writeKnowledgeEntrySchema,
} from './write-knowledge-entry.schema.js';

/**
 * Insert a single knowledge entry with an embedding.
 *
 * Companion to `queryKnowledge` (read side) and `upsertKnowledgeEntry`
 * (the org-wide upsert helper used by the legacy populators). Unlike
 * `upsertKnowledgeEntry`, this is a pure INSERT — every call writes a new
 * row. That's intentional for the `remember` tool: each user-expressed
 * memory is a distinct entry, not a re-statement of the same logical fact.
 *
 * Scope is `(organizationId, userId)`:
 *   - `userId: null` → org-wide entry (visible to every user in the org).
 *   - `userId: <id>` → personal entry (visible only to that user).
 *
 * `queryKnowledge` (post-W-C13-schema) honours this contract by filtering
 * `WHERE organization_id = $org AND (user_id IS NULL OR user_id = $user)`
 * when invoked with a user id, and `user_id IS NULL` otherwise.
 *
 * Embedding is generated via OpenAI text-embedding-3-small (1536d) — the
 * same model `populate.ts` uses, so the pgvector index handles all entries
 * uniformly.
 */
const writeKnowledgeEntryImpl = async (
  db: DbConnection,
  input: WriteKnowledgeEntryInput
): Promise<Result<WriteKnowledgeEntryOutput>> => {
  const parsed = writeKnowledgeEntrySchema.safeParse(input);
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
    type,
    title,
    content,
    source,
    confidence,
    metadata,
  } = parsed.data;

  let embeddingStr: string;
  try {
    const embedding = await generateEmbedding(content);
    embeddingStr = `[${embedding.join(',')}]`;
  } catch (error) {
    logError('assistant.writeKnowledgeEntry.embed', error, {
      feature: 'assistant',
      extra: { organizationId, userId, type },
    });
    return err(
      new FeatureError(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        'Failed to generate embedding for knowledge entry'
      )
    );
  }

  const metadataJson = metadata ? JSON.stringify(metadata) : null;

  // NOTE (RLS W-SYS flag): writeKnowledgeEntry is called from BOTH the
  // request path (summariseConversation, meta_remember tool) AND the nightly
  // cron (buildOperationalSnapshot → runOperationalSnapshotCron). It accepts
  // a DbConnection so callers are responsible for scoping:
  //   - request-path callers → `withOrgScope` at the call site (already done)
  //   - cron callers → `withSystemScope` at the call site (W-SYS to handle)
  // The insert itself is correct once the db connection is properly scoped.
  try {
    const inserted = await db.execute<{ id: string }>(sql`
      INSERT INTO knowledge_entry (
        id, organization_id, user_id, type, title, content,
        embedding, source, confidence, metadata, created_at, updated_at
      ) VALUES (
        gen_random_uuid(),
        ${organizationId},
        ${userId},
        ${type},
        ${title},
        ${content},
        ${embeddingStr}::vector,
        ${source},
        ${confidence ?? 1.0},
        ${metadataJson}::jsonb,
        NOW(),
        NOW()
      )
      RETURNING id
    `);

    const row = inserted[0];
    if (!row) {
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'Failed to write knowledge entry'
        )
      );
    }

    return ok({ knowledgeEntryId: row.id });
  } catch (error) {
    logError('assistant.writeKnowledgeEntry.insert', error, {
      feature: 'assistant',
      extra: { organizationId, userId, type },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to write knowledge entry'
      )
    );
  }
};

export const writeKnowledgeEntry = (
  db: DbConnection,
  input: WriteKnowledgeEntryInput
) =>
  trackedResult(
    'assistant.writeKnowledgeEntry',
    () => writeKnowledgeEntryImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        userId: input.userId ?? '(org-wide)',
        type: input.type,
      },
      internalErrorsOnly: true,
    }
  );

export type WriteKnowledgeEntryResult = Awaited<
  ReturnType<typeof writeKnowledgeEntry>
>;
