import {
  and,
  assistantConversation,
  desc,
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
  type ListConversationsInput,
  listConversationsSchema,
} from './list-conversations.schema.js';

export interface ConversationSummary {
  id: string;
  title: string | null;
  status: 'active' | 'escalated';
  escalatedAt: Date | null;
  escalationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const listConversationsImpl = async (
  db: DbConnection,
  input: ListConversationsInput
): Promise<Result<{ conversations: ConversationSummary[] }>> => {
  const parsed = listConversationsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, userId } = parsed.data;

  try {
    const conversations = await withOrgScope(
      (tx) =>
        tx.query.assistantConversation.findMany({
          where: and(
            eq(assistantConversation.organizationId, organizationId),
            eq(assistantConversation.userId, userId),
            notDeleted(assistantConversation)
          ),
          orderBy: [desc(assistantConversation.updatedAt)],
          columns: {
            id: true,
            title: true,
            status: true,
            escalatedAt: true,
            escalationReason: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
      { db }
    );

    return ok({ conversations });
  } catch (error) {
    logError('assistant.listConversations', error, {
      feature: 'assistant',
      extra: { organizationId, userId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to list conversations'
      )
    );
  }
};

export const listConversations = (
  db: DbConnection,
  input: ListConversationsInput
) =>
  trackedResult(
    'assistant.listConversations',
    () => listConversationsImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );
