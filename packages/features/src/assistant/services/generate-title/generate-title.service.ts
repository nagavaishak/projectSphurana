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
  type GenerateTitleInput,
  generateTitleSchema,
} from './generate-title.schema.js';

const generateTitleImpl = async (
  db: DbConnection,
  input: GenerateTitleInput
): Promise<Result<{ title: string }>> => {
  const parsed = generateTitleSchema.safeParse(input);
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
    userId,
    userMessage,
    assistantResponse,
  } = parsed.data;

  try {
    // Verify ownership
    const conversation = await withOrgScope(
      (tx) =>
        tx.query.assistantConversation.findFirst({
          where: and(
            eq(assistantConversation.id, conversationId),
            eq(assistantConversation.organizationId, organizationId),
            eq(assistantConversation.userId, userId),
            notDeleted(assistantConversation)
          ),
          columns: { id: true },
        }),
      { db }
    );

    if (!conversation) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Conversation not found')
      );
    }

    const { chatCompletion } = await import('@borradh-workspace/ai');

    const result = await chatCompletion(
      `User: ${userMessage.slice(0, 300)}\nAssistant: ${assistantResponse.slice(0, 300)}`,
      {
        systemMessage:
          'Generate a short 3-5 word title for this conversation. Return ONLY the title, no quotes, no punctuation at the end.',
        maxTokens: 20,
      }
    );

    const title = result.content.trim().slice(0, 60);
    if (!title) {
      return err(
        new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to generate title')
      );
    }

    await withOrgScope(
      (tx) =>
        tx
          .update(assistantConversation)
          .set({ title })
          .where(
            and(
              eq(assistantConversation.id, conversationId),
              eq(assistantConversation.organizationId, organizationId),
              eq(assistantConversation.userId, userId),
              notDeleted(assistantConversation)
            )
          ),
      { db }
    );

    return ok({ title });
  } catch (error) {
    logError('assistant.generateTitle', error, {
      feature: 'assistant',
      extra: { conversationId, organizationId, userId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to generate conversation title'
      )
    );
  }
};

export const generateConversationTitle = (
  db: DbConnection,
  input: GenerateTitleInput
) =>
  trackedResult('assistant.generateTitle', () => generateTitleImpl(db, input), {
    properties: { conversationId: input.conversationId },
  });
