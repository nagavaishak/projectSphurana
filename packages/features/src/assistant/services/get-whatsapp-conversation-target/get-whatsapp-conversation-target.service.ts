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
  type GetWhatsappConversationTargetInput,
  getWhatsappConversationTargetSchema,
} from './get-whatsapp-conversation-target.schema.js';

export interface WhatsappConversationTarget {
  conversationId: string;
  userId: string;
  /** Owner's paired E.164 (digits only). Null when the link was revoked or the
   *  conversation isn't a whatsapp one. */
  phoneE164: string | null;
}

/**
 * Resolve the outbound delivery target (paired phone + owner) for a whatsapp
 * conversation. Used by the proactive outbound worker to know where to push an
 * async result. Returns NOT_FOUND if the conversation doesn't exist in the org.
 */
const getWhatsappConversationTargetImpl = async (
  db: DbConnection,
  input: GetWhatsappConversationTargetInput
): Promise<Result<WhatsappConversationTarget>> => {
  const parsed = getWhatsappConversationTargetSchema.safeParse(input);
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
      async (tx) =>
        tx.query.assistantConversation.findFirst({
          where: and(
            eq(assistantConversation.id, conversationId),
            eq(assistantConversation.organizationId, organizationId)
          ),
          columns: { id: true, userId: true, whatsappPhoneE164: true },
        }),
      { db }
    );

    if (!row) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Conversation not found')
      );
    }

    return ok({
      conversationId: row.id,
      userId: row.userId,
      phoneE164: row.whatsappPhoneE164 ?? null,
    });
  } catch (error) {
    logError('assistant.getWhatsappConversationTarget', error, {
      feature: 'assistant',
      extra: { conversationId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to resolve whatsapp conversation target'
      )
    );
  }
};

export const getWhatsappConversationTarget = (
  db: DbConnection,
  input: GetWhatsappConversationTargetInput
) =>
  trackedResult(
    'assistant.getWhatsappConversationTarget',
    () => getWhatsappConversationTargetImpl(db, input),
    {
      properties: { conversationId: input.conversationId },
      internalErrorsOnly: true,
    }
  );
