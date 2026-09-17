import {
  and,
  assistantConversation,
  eq,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { sql } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { getSkillById } from '../../skills/index.js';
import {
  type AppendLoadedSkillInput,
  type AppendLoadedSkillOutput,
  appendLoadedSkillSchema,
} from './append-loaded-skill.schema.js';

/**
 * Append a skill to a conversation's `loaded_skill_ids` set.
 *
 * Idempotent and concurrent-safe: the update is a single SQL statement that
 * unions the existing array with the new id and dedupes. Two parallel calls
 * produce a union, not a lost-update — the row is updated atomically by
 * Postgres each time.
 *
 * Validates the skill against the in-process registry before the SQL call;
 * an unknown id surfaces as `VALIDATION_ERROR` so the caller (the
 * `load_skill` tool) can echo the failure back to the model. The model's
 * own input validation (the tool's Zod input + the orchestrator's skill
 * index in the system prompt) is the first line of defence; this is the
 * second.
 */
const appendLoadedSkillImpl = async (
  db: DbConnection,
  input: AppendLoadedSkillInput
): Promise<Result<AppendLoadedSkillOutput>> => {
  const parsed = appendLoadedSkillSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { conversationId, organizationId, skillId } = parsed.data;

  if (!getSkillById(skillId)) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        `Unknown skill id "${skillId}".`
      )
    );
  }

  try {
    // Atomic dedup-append. `array(select distinct unnest(...))` is the
    // canonical Postgres idiom for set-union over a text[] column. Order
    // is not preserved across the union — callers that care about
    // insertion order should not rely on it. The controller treats
    // `loaded_skill_ids` as a set anyway.
    const updated = await withOrgScope(
      (tx) =>
        tx
          .update(assistantConversation)
          .set({
            loadedSkillIds: sql`array(select distinct unnest(${assistantConversation.loadedSkillIds} || array[${skillId}]::text[]))`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(assistantConversation.id, conversationId),
              eq(assistantConversation.organizationId, organizationId),
              notDeleted(assistantConversation)
            )
          )
          .returning({
            loadedSkillIds: assistantConversation.loadedSkillIds,
          }),
      { db }
    );

    if (!updated.length) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Conversation not found')
      );
    }

    return ok({ loadedSkillIds: updated[0].loadedSkillIds });
  } catch (error) {
    logError('assistant.appendLoadedSkill', error, {
      feature: 'assistant',
      extra: { conversationId, organizationId, skillId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to append loaded skill'
      )
    );
  }
};

export const appendLoadedSkill = (
  db: DbConnection,
  input: AppendLoadedSkillInput
) =>
  trackedResult(
    'assistant.appendLoadedSkill',
    () => appendLoadedSkillImpl(db, input),
    {
      properties: {
        conversationId: input.conversationId,
        organizationId: input.organizationId,
        skillId: input.skillId,
      },
      internalErrorsOnly: true,
    }
  );

export type AppendLoadedSkillResult = Awaited<
  ReturnType<typeof appendLoadedSkill>
>;
