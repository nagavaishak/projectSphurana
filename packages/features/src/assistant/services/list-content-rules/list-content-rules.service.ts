import {
  and,
  asc,
  eq,
  gt,
  isNull,
  knowledgeEntry,
  or,
  sql,
  withOrgScope,
} from '@borradh-workspace/database';
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
  type ListContentRulesInput,
  type ListContentRulesOutput,
  listContentRulesSchema,
} from './list-content-rules.schema.js';

/**
 * Hard ceiling on how many rules reach a prompt.
 *
 * Rules are unbounded user input pasted into every generation, so without a cap
 * an org that never prunes would slowly crowd out the rest of the prompt and
 * degrade the very copy the rules were meant to improve. Twenty is far above
 * realistic use (a clinic has three or four) and low enough to stay harmless.
 */
export const MAX_CONTENT_RULES = 20;

/**
 * The org's standing content rules, oldest first.
 *
 * Deliberately a plain filtered SELECT rather than `queryKnowledge`'s semantic
 * top-k. Retrieval is the wrong tool here: these are few, and EVERY one has to
 * apply to EVERY generation. Ranking them by similarity to the current post
 * would silently drop "always mention the €50 deposit" from a post that didn't
 * already mention money — exactly the post that needed it.
 *
 * Filters mirror how the rules are written by `saveContentRule`:
 *   - `type = 'preference'` — the user-managed memory bucket
 *   - `user_id IS NULL` — org-wide only, never someone's personal memory
 *   - `metadata->>'domain' = 'content'` — separates content rules from every
 *     other preference Claire's `remember` tool may have stored
 *   - unexpired
 */
const listContentRulesImpl = async (
  db: DbConnection,
  input: ListContentRulesInput
): Promise<Result<ListContentRulesOutput>> => {
  const parsed = listContentRulesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  try {
    const rows = await withOrgScope(
      (tx) =>
        tx
          .select({
            id: knowledgeEntry.id,
            title: knowledgeEntry.title,
            content: knowledgeEntry.content,
            createdAt: knowledgeEntry.createdAt,
          })
          .from(knowledgeEntry)
          .where(
            and(
              eq(knowledgeEntry.organizationId, organizationId),
              eq(knowledgeEntry.type, 'preference'),
              isNull(knowledgeEntry.userId),
              sql`${knowledgeEntry.metadata}->>'domain' = 'content'`,
              or(
                isNull(knowledgeEntry.expiresAt),
                gt(knowledgeEntry.expiresAt, new Date())
              )
            )
          )
          .orderBy(asc(knowledgeEntry.createdAt))
          .limit(MAX_CONTENT_RULES),
      { db }
    );

    return ok({
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        content: row.content,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    logError('assistant.listContentRules', error, {
      feature: 'assistant',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to load content rules'
      )
    );
  }
};

export const listContentRules = (
  db: DbConnection,
  input: ListContentRulesInput
) =>
  trackedResult(
    'assistant.listContentRules',
    () => listContentRulesImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type ListContentRulesResult = Awaited<
  ReturnType<typeof listContentRules>
>;

/**
 * Rules as prompt lines, for the generation paths. Returns `[]` on failure —
 * a rules lookup that errors must degrade to "generate without them" rather
 * than fail the whole generation.
 */
export const getContentRuleLines = async (
  db: DbConnection,
  organizationId: string
): Promise<string[]> => {
  const result = await listContentRules(db, { organizationId });
  if (!result.success) return [];
  return result.data.items.map((rule) => rule.content);
};
