import {
  and,
  assistantConversation,
  assistantMessage,
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
  type SaveMessagesInput,
  saveMessagesSchema,
} from './save-messages.schema.js';

const saveMessagesImpl = async (
  db: DbConnection,
  input: SaveMessagesInput
): Promise<Result<{ success: true }>> => {
  const parsed = saveMessagesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    conversationId,
    userMessageContent,
    assistantText,
    toolCalls,
    toolResults,
  } = parsed.data;

  const now = new Date();

  try {
    // assistantMessage is Bucket B (child-of-org); no withOrgScope needed for
    // the insert itself. The assistantConversation touch-update is Bucket A.
    await withOrgScope(
      async (tx) => {
        const updated = await tx
          .update(assistantConversation)
          .set({ updatedAt: new Date() })
          .where(
            and(
              eq(assistantConversation.id, conversationId),
              notDeleted(assistantConversation)
            )
          )
          .returning({ id: assistantConversation.id });

        if (!updated.length) {
          throw new FeatureError(
            ErrorCodes.NOT_FOUND,
            'Conversation not found'
          );
        }

        await tx.insert(assistantMessage).values([
          {
            conversationId,
            role: 'user' as const,
            content: userMessageContent,
            createdAt: now,
          },
          {
            conversationId,
            role: 'assistant' as const,
            content: assistantText || null,
            toolCalls: toolCalls ?? null,
            toolResults: toolResults ?? null,
            createdAt: new Date(now.getTime() + 1),
          },
        ]);
      },
      { db }
    );

    return ok({ success: true });
  } catch (error) {
    if (error instanceof FeatureError) {
      return err(error);
    }

    logError('assistant.saveMessages', error, {
      feature: 'assistant',
      extra: { conversationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to save messages')
    );
  }
};

export const saveMessages = (db: DbConnection, input: SaveMessagesInput) =>
  trackedResult('assistant.saveMessages', () => saveMessagesImpl(db, input), {
    properties: { conversationId: input.conversationId },
  });
