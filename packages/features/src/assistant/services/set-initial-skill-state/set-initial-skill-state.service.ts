import {
  and,
  assistantConversation,
  eq,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
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
  type SetInitialSkillStateInput,
  type SetInitialSkillStateOutput,
  setInitialSkillStateSchema,
} from './set-initial-skill-state.schema.js';

/**
 * Set a conversation's initial `loaded_skill_ids` + `skill_registry_version`
 * in a single atomic UPDATE.
 *
 * Called by the controller on first turn after `createConversation` returns,
 * once `classifyIntent` has produced the initial skill set. Distinct from
 * `appendLoadedSkill` (which dedup-unions a single id into the array): this
 * one *replaces* the array with the classifier's output, and it also pins
 * the registry version so in-flight conversations stay locked to a frozen
 * skill payload even if the registry bumps mid-conversation.
 *
 * Unknown skill IDs are rejected as `VALIDATION_ERROR` so a classifier bug
 * can't silently strand the conversation in an invalid state. The
 * controller's classifier already filters unknown ids, but defense in depth
 * keeps the contract clean.
 */
const setInitialSkillStateImpl = async (
  db: DbConnection,
  input: SetInitialSkillStateInput
): Promise<Result<SetInitialSkillStateOutput>> => {
  const parsed = setInitialSkillStateSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    conversationId,
    organizationId,
    loadedSkillIds,
    skillRegistryVersion,
  } = parsed.data;

  const deduped = Array.from(new Set(loadedSkillIds));
  for (const id of deduped) {
    if (!getSkillById(id)) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          `Unknown skill id "${id}".`
        )
      );
    }
  }

  try {
    const [row] = await withOrgScope(
      (tx) =>
        tx
          .update(assistantConversation)
          .set({
            loadedSkillIds: deduped,
            skillRegistryVersion,
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
            skillRegistryVersion: assistantConversation.skillRegistryVersion,
          }),
      { db }
    );

    if (!row) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Conversation not found')
      );
    }

    return ok({
      loadedSkillIds: row.loadedSkillIds,
      skillRegistryVersion: row.skillRegistryVersion,
    });
  } catch (error) {
    logError('assistant.setInitialSkillState', error, {
      feature: 'assistant',
      extra: { conversationId, organizationId, loadedSkillIds: deduped },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to set initial skill state'
      )
    );
  }
};

export const setInitialSkillState = (
  db: DbConnection,
  input: SetInitialSkillStateInput
) =>
  trackedResult(
    'assistant.setInitialSkillState',
    () => setInitialSkillStateImpl(db, input),
    {
      properties: {
        conversationId: input.conversationId,
        organizationId: input.organizationId,
        skillCount: input.loadedSkillIds.length,
      },
      internalErrorsOnly: true,
    }
  );

export type SetInitialSkillStateResult = Awaited<
  ReturnType<typeof setInitialSkillState>
>;
