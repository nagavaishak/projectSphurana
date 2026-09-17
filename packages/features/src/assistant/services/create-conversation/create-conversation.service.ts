import {
  assistantConversation,
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
import { SKILL_REGISTRY_VERSION } from '../../skills/index.js';
import {
  type CreateConversationInput,
  createConversationSchema,
} from './create-conversation.schema.js';

const createConversationImpl = async (
  db: DbConnection,
  input: CreateConversationInput
): Promise<Result<{ id: string }>> => {
  const parsed = createConversationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, userId, title } = parsed.data;

  try {
    const [row] = await withOrgScope(
      (tx) =>
        tx
          .insert(assistantConversation)
          .values({
            organizationId,
            userId,
            title: title || null,
            // Pin the skill-prompt version at CREATION. The frontend pre-creates a
            // conversation before the first chat turn, so the chat controller's
            // first-turn bump (`setInitialSkillState`, gated on no conversationId)
            // never runs for it — without this the row keeps the schema default
            // (v1) for life and the conversation runs frozen on the oldest prompts.
            skillRegistryVersion: SKILL_REGISTRY_VERSION,
          })
          .returning({ id: assistantConversation.id }),
      { db }
    );

    return ok({ id: row.id });
  } catch (error) {
    logError('assistant.createConversation', error, {
      feature: 'assistant',
      extra: { organizationId, userId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to create conversation'
      )
    );
  }
};

export const createConversation = (
  db: DbConnection,
  input: CreateConversationInput
) =>
  trackedResult(
    'assistant.createConversation',
    () => createConversationImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );
