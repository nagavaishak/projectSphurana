import { conversationMessage } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type UpdateMessageStatusInput,
  updateMessageStatusSchema,
} from './update-message-status.schema.js';

const STATUS_FIELD_MAP: Record<string, 'sentAt' | 'deliveredAt' | 'readAt'> = {
  sent: 'sentAt',
  delivered: 'deliveredAt',
  read: 'readAt',
};

const updateMessageStatusImpl = async (
  db: DbConnection,
  input: UpdateMessageStatusInput
): Promise<Result<{ updated: boolean }>> => {
  const parsed = updateMessageStatusSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const field = STATUS_FIELD_MAP[parsed.data.status];
  if (!field) {
    return ok({ updated: false });
  }

  try {
    await db
      .update(conversationMessage)
      .set({ [field]: new Date(parsed.data.timestamp) })
      .where(
        eq(conversationMessage.externalMessageId, parsed.data.externalMessageId)
      );

    return ok({ updated: true });
  } catch (error) {
    logError('conversations.updateMessageStatus', error, {
      feature: 'conversations',
      extra: {
        externalMessageId: parsed.data.externalMessageId,
        status: parsed.data.status,
      },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to update message status'
      )
    );
  }
};

export const updateMessageStatus = (
  db: DbConnection,
  input: UpdateMessageStatusInput
) =>
  trackedResult(
    'conversations.updateMessageStatus',
    () => updateMessageStatusImpl(db, input),
    {
      properties: {
        externalMessageId: input.externalMessageId,
        status: input.status,
      },
      internalErrorsOnly: true,
    }
  );

export type UpdateMessageStatusResult = Awaited<
  ReturnType<typeof updateMessageStatus>
>;
