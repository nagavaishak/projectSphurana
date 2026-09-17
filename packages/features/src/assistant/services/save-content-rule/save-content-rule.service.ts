import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  MAX_CONTENT_RULES,
  listContentRules,
} from '../list-content-rules/list-content-rules.service.js';
import { writeKnowledgeEntry } from '../write-knowledge-entry/write-knowledge-entry.service.js';
import {
  type SaveContentRuleInput,
  type SaveContentRuleOutput,
  saveContentRuleSchema,
} from './save-content-rule.schema.js';

/**
 * Promote an instruction the user gave during review into a standing rule.
 *
 * A thin, opinionated wrapper over `writeKnowledgeEntry` — it exists so the
 * scope/type/metadata that make a row a *content rule* are decided in exactly
 * one place. Written as:
 *   - `type: 'preference'` — the user-managed bucket the memories settings page
 *     already lists, so rules are visible and deletable there for free
 *   - `userId: null` — org-wide; see `listContentRules` for why not personal
 *   - `source: 'ai'` — Claire proposed the wording, even though a human accepted
 *   - `metadata.domain: 'content'` — the discriminator `listContentRules` filters on
 *
 * This is only ever called from an explicit user action (tapping the suggested
 * rule chip). Nothing auto-saves: a rule silently applied to every future post
 * for the whole org is a much worse failure than one the user has to tap.
 */
const saveContentRuleImpl = async (
  db: DbConnection,
  input: SaveContentRuleInput
): Promise<Result<SaveContentRuleOutput>> => {
  const parsed = saveContentRuleSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, title, content, batchId } = parsed.data;

  // Refuse past the cap rather than accept a write that `listContentRules`
  // would then silently drop off the end of its LIMIT — a rule the user was
  // told was saved but which never reaches a prompt is worse than a clear no.
  const existing = await listContentRules(db, { organizationId });
  if (existing.success && existing.data.items.length >= MAX_CONTENT_RULES) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        `You already have ${MAX_CONTENT_RULES} content rules. Remove one before adding another.`
      )
    );
  }

  // Duplicate rules are pure prompt noise and read as a bug in the chip strip.
  if (
    existing.success &&
    existing.data.items.some(
      (rule) =>
        rule.content.trim().toLowerCase() === content.trim().toLowerCase()
    )
  ) {
    return err(
      new FeatureError(ErrorCodes.ALREADY_EXISTS, 'That rule is already saved')
    );
  }

  const written = await writeKnowledgeEntry(db, {
    organizationId,
    userId: null,
    type: 'preference',
    title,
    content,
    source: 'ai',
    metadata: {
      domain: 'content',
      origin: 'batch-review',
      ...(batchId ? { batchId } : {}),
    },
  });

  // Re-wrap rather than collapse to INTERNAL_ERROR: the embedding call can fail
  // with EXTERNAL_SERVICE_ERROR, and the user deserves "try again" instead of
  // "something broke".
  if (!written.success) {
    return err(
      new FeatureError(
        written.error.code,
        written.error.message,
        written.error.details
      )
    );
  }

  return ok({ id: written.data.knowledgeEntryId });
};

export const saveContentRule = (
  db: DbConnection,
  input: SaveContentRuleInput
) =>
  trackedResult(
    'assistant.saveContentRule',
    () => saveContentRuleImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        batchId: input.batchId,
      },
    }
  );

export type SaveContentRuleResult = Awaited<ReturnType<typeof saveContentRule>>;
