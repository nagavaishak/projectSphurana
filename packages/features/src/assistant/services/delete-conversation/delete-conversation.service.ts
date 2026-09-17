import {
  and,
  assistantConversation,
  eq,
  withOrgScope,
} from '@borradh-workspace/database';
import {
  isFeatureOn,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  logAuditEvent,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type DeleteConversationInput,
  deleteConversationSchema,
} from './delete-conversation.schema.js';

const deleteConversationImpl = async (
  db: DbConnection,
  input: DeleteConversationInput,
  auditDb: DbConnection = db
): Promise<Result<{ success: true }>> => {
  const parsed = deleteConversationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId, userId } = parsed.data;

  try {
    if (!(await isFeatureOn('killswitch-soft-deletes'))) {
      await db
        .delete(assistantConversation)
        .where(
          and(
            eq(assistantConversation.id, id),
            eq(assistantConversation.organizationId, organizationId),
            eq(assistantConversation.userId, userId)
          )
        );
      return ok({ success: true });
    }

    const result = await withOrgScope(
      (tx) =>
        tx
          .update(assistantConversation)
          .set({ deletedAt: new Date() })
          .where(
            and(
              eq(assistantConversation.id, id),
              eq(assistantConversation.organizationId, organizationId),
              eq(assistantConversation.userId, userId),
              notDeleted(assistantConversation)
            )
          )
          .returning({ id: assistantConversation.id }),
      { db }
    );

    if (!result.length) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Conversation not found')
      );
    }

    logAuditEvent(auditDb, {
      action: 'delete',
      entityType: 'assistant_conversation',
      entityId: id,
      actorType: 'user',
      actorId: userId,
      organizationId,
    }).catch((error) => {
      logError('assistant.deleteConversation.auditLog', error, {
        feature: 'assistant',
        extra: { id, organizationId, userId },
      });
    });

    return ok({ success: true });
  } catch (error) {
    logError('assistant.deleteConversation', error, {
      feature: 'assistant',
      extra: { id, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to delete conversation'
      )
    );
  }
};

export const deleteConversation = (
  db: DbConnection,
  input: DeleteConversationInput
) =>
  trackedResult(
    'assistant.deleteConversation',
    () => deleteConversationImpl(db, input, db),
    {
      properties: { id: input.id, organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );
