import {
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
  ok,
} from '../../../shared/index.js';
import {
  type ClearPendingConfirmationInput,
  type GetPendingConfirmationInput,
  type PendingConfirmation,
  type SetPendingConfirmationInput,
  clearPendingConfirmationSchema,
  getPendingConfirmationSchema,
  setPendingConfirmationSchema,
} from './pending-confirmation.schema.js';

/**
 * WS-8 — pending-confirmation helpers on the assistant conversation.
 *
 * These three services own the `pendingConfirmation` jsonb column (WS-4) used
 * by the WhatsApp channel to bridge a preview → text-affirmation → publish
 * flow. They are intentionally tiny CRUD wrappers so the worker (WS-10) and
 * preview tools (WS-6) can drive the gate without duplicating drizzle.
 *
 * Web is unaffected: the column stays null on web conversations and the
 * tool-factory gate keeps using the frontend button-confirmation token path.
 */

const updatePendingConfirmation = async (
  db: DbConnection,
  locator: { conversationId: string; organizationId: string },
  value: PendingConfirmation | null
): Promise<Result<{ id: string }>> => {
  const result = await withOrgScope(
    (tx) =>
      tx
        .update(assistantConversation)
        .set({ pendingConfirmation: value, updatedAt: new Date() })
        .where(
          and(
            eq(assistantConversation.id, locator.conversationId),
            eq(assistantConversation.organizationId, locator.organizationId)
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
  return ok({ id: result[0].id });
};

const setPendingConfirmationImpl = async (
  db: DbConnection,
  input: SetPendingConfirmationInput
): Promise<Result<{ id: string }>> => {
  const parsed = setPendingConfirmationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { conversationId, organizationId, kind, draftId } = parsed.data;
  try {
    return await updatePendingConfirmation(
      db,
      { conversationId, organizationId },
      { kind, draftId }
    );
  } catch (error) {
    logError('assistant.setPendingConfirmation', error, {
      feature: 'assistant',
      extra: { conversationId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to set pending confirmation'
      )
    );
  }
};

const clearPendingConfirmationImpl = async (
  db: DbConnection,
  input: ClearPendingConfirmationInput
): Promise<Result<{ id: string }>> => {
  const parsed = clearPendingConfirmationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { conversationId, organizationId } = parsed.data;
  try {
    return await updatePendingConfirmation(
      db,
      { conversationId, organizationId },
      null
    );
  } catch (error) {
    logError('assistant.clearPendingConfirmation', error, {
      feature: 'assistant',
      extra: { conversationId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to clear pending confirmation'
      )
    );
  }
};

const getPendingConfirmationImpl = async (
  db: DbConnection,
  input: GetPendingConfirmationInput
): Promise<Result<PendingConfirmation | null>> => {
  const parsed = getPendingConfirmationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { conversationId, organizationId } = parsed.data;
  try {
    const row = await withOrgScope(
      (tx) =>
        tx.query.assistantConversation.findFirst({
          where: and(
            eq(assistantConversation.id, conversationId),
            eq(assistantConversation.organizationId, organizationId)
          ),
          columns: { pendingConfirmation: true },
        }),
      { db }
    );

    if (!row) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Conversation not found')
      );
    }

    return ok((row.pendingConfirmation as PendingConfirmation | null) ?? null);
  } catch (error) {
    logError('assistant.getPendingConfirmation', error, {
      feature: 'assistant',
      extra: { conversationId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to read pending confirmation'
      )
    );
  }
};

export const setPendingConfirmation = (
  db: DbConnection,
  input: SetPendingConfirmationInput
) =>
  trackedResult(
    'assistant.setPendingConfirmation',
    () => setPendingConfirmationImpl(db, input),
    {
      properties: {
        conversationId: input.conversationId,
        organizationId: input.organizationId,
      },
      internalErrorsOnly: true,
    }
  );

export const clearPendingConfirmation = (
  db: DbConnection,
  input: ClearPendingConfirmationInput
) =>
  trackedResult(
    'assistant.clearPendingConfirmation',
    () => clearPendingConfirmationImpl(db, input),
    {
      properties: {
        conversationId: input.conversationId,
        organizationId: input.organizationId,
      },
      internalErrorsOnly: true,
    }
  );

export const getPendingConfirmation = (
  db: DbConnection,
  input: GetPendingConfirmationInput
) =>
  trackedResult(
    'assistant.getPendingConfirmation',
    () => getPendingConfirmationImpl(db, input),
    {
      properties: {
        conversationId: input.conversationId,
        organizationId: input.organizationId,
      },
      internalErrorsOnly: true,
    }
  );
