import {
  type AssistantConversation,
  assistantConversation,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
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
  type EscalateConversationInput,
  escalateConversationSchema,
} from './escalate-conversation.schema.js';

const escalateConversationImpl = async (
  db: DbConnection,
  input: EscalateConversationInput
): Promise<Result<Pick<AssistantConversation, 'id' | 'status'>>> => {
  const parsed = escalateConversationSchema.safeParse(input);
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
    reason,
    intercomConversationId,
  } = parsed.data;

  try {
    // Scope by orgId + userId so one user can't escalate another user's
    // conversation even with a crafted id. Also makes the query idempotent:
    // re-escalating already-escalated is a no-op that still returns ok.
    const [row] = await withOrgScope(
      (tx) =>
        tx
          .update(assistantConversation)
          .set({
            status: 'escalated',
            escalatedAt: new Date(),
            escalationReason: reason ?? 'user_requested',
            ...(intercomConversationId ? { intercomConversationId } : {}),
          })
          .where(
            and(
              eq(assistantConversation.id, conversationId),
              eq(assistantConversation.organizationId, organizationId),
              eq(assistantConversation.userId, userId),
              notDeleted(assistantConversation)
            )
          )
          .returning({
            id: assistantConversation.id,
            status: assistantConversation.status,
          }),
      { db }
    );

    if (!row) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Conversation not found')
      );
    }

    return ok(row);
  } catch (error) {
    logError('assistant.escalateConversation', error, {
      feature: 'assistant',
      extra: { conversationId, organizationId, userId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to escalate conversation'
      )
    );
  }
};

export const escalateConversation = (
  db: DbConnection,
  input: EscalateConversationInput
) =>
  trackedResult(
    'assistant.escalateConversation',
    () => escalateConversationImpl(db, input),
    {
      properties: {
        conversationId: input.conversationId,
        organizationId: input.organizationId,
      },
    }
  );
