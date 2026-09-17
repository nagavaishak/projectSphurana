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
import {
  type UpdateConversationInput,
  updateConversationSchema,
} from './update-conversation.schema.js';

const updateConversationImpl = async (
  db: DbConnection,
  input: UpdateConversationInput
): Promise<Result<{ id: string; title: string; updatedAt: Date }>> => {
  const parsed = updateConversationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId, userId, title } = parsed.data;

  try {
    const result = await withOrgScope(
      (tx) =>
        tx
          .update(assistantConversation)
          .set({ title, updatedAt: new Date() })
          .where(
            and(
              eq(assistantConversation.id, id),
              eq(assistantConversation.organizationId, organizationId),
              eq(assistantConversation.userId, userId),
              notDeleted(assistantConversation)
            )
          )
          .returning({
            id: assistantConversation.id,
            title: assistantConversation.title,
            updatedAt: assistantConversation.updatedAt,
          }),
      { db }
    );

    if (!result.length) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Conversation not found')
      );
    }

    return ok({
      id: result[0].id,
      title: result[0].title ?? '',
      updatedAt: result[0].updatedAt,
    });
  } catch (error) {
    logError('assistant.updateConversation', error, {
      feature: 'assistant',
      extra: { id, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to update conversation'
      )
    );
  }
};

export const updateConversation = (
  db: DbConnection,
  input: UpdateConversationInput
) =>
  trackedResult(
    'assistant.updateConversation',
    () => updateConversationImpl(db, input),
    {
      properties: { id: input.id, organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );
