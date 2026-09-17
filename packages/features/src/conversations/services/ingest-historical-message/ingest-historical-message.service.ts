import { conversation, conversationMessage } from '@borradh-workspace/database';
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
import { resolveTenantContext } from '../handle-incoming-message/resolve-message-context.js';
import {
  type IngestHistoricalMessageInput,
  ingestHistoricalMessageSchema,
} from './ingest-historical-message.schema.js';

/**
 * Persist one message from the WhatsApp Coexistence `history` webhook.
 *
 * Creates the conversation if it doesn't exist (status `agent_handling` so
 * the bot doesn't activate on ancient pre-Borradh chats) and upserts the
 * message with `origin: 'backfill'`. Idempotent on `externalMessageId`.
 *
 * Deliberately skips all side-effects the live handler performs: bot flow
 * scheduling, response timeouts, follow-ups, agent notifications, ad
 * referral resolution, lead creation.
 */
const ingestHistoricalMessageImpl = async (
  db: DbConnection,
  input: IngestHistoricalMessageInput
): Promise<
  Result<{ conversationId: string; messageId: string | null; created: boolean }>
> => {
  const parsed = ingestHistoricalMessageSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    // Resolve tenant context via the same dispatcher used by the live
    // handlers. Returns organizationId + isChatbotActive + whatsappAccountId.
    const context = await resolveTenantContext(
      db,
      parsed.data.platform,
      parsed.data.pageId
    );

    if (!context || !context.whatsappAccountId) {
      return err(
        new FeatureError(
          ErrorCodes.NOT_FOUND,
          `No whatsapp account for phone_number_id ${parsed.data.pageId}`
        )
      );
    }

    const sentAt = new Date(parsed.data.timestamp);

    let conv = await db.query.conversation.findFirst({
      where: and(
        eq(conversation.organizationId, context.organizationId),
        eq(conversation.externalUserId, parsed.data.externalUserId),
        eq(conversation.platform, 'whatsapp')
      ),
    });

    if (!conv) {
      // Seed status from the page's chatbot toggle alone. Lead vs. returning-
      // contact triage is Claire's job now — she classifies every inbound and
      // silently hands non-leads (returning clients, personal messages, spam)
      // to the owner — so seeding no longer consults a newLeadsOnly setting.
      const seededStatus = context.isChatbotActive
        ? 'bot_handling'
        : 'agent_handling';

      const [created] = await db
        .insert(conversation)
        .values({
          organizationId: context.organizationId,
          whatsappAccountId: context.whatsappAccountId,
          externalUserId: parsed.data.externalUserId,
          platform: 'whatsapp',
          status: seededStatus,
          lastMessageAt: sentAt,
        })
        .onConflictDoNothing()
        .returning();

      if (created) {
        conv = created;
      } else {
        // Race: another historical chunk just created it. Re-read.
        conv = await db.query.conversation.findFirst({
          where: and(
            eq(conversation.organizationId, context.organizationId),
            eq(conversation.externalUserId, parsed.data.externalUserId),
            eq(conversation.platform, 'whatsapp')
          ),
        });
      }

      if (!conv) {
        return err(
          new FeatureError(
            ErrorCodes.INTERNAL_ERROR,
            'Failed to resolve historical conversation'
          )
        );
      }
    }

    const inserted = await db
      .insert(conversationMessage)
      .values({
        conversationId: conv.id,
        role: parsed.data.role,
        content: parsed.data.messageText,
        messageType: 'text',
        externalMessageId: parsed.data.externalMessageId,
        origin: 'backfill',
        sentAt,
      })
      .onConflictDoNothing()
      .returning();

    const messageId = inserted[0]?.id ?? null;

    if (sentAt > (conv.lastMessageAt ?? new Date(0))) {
      await db
        .update(conversation)
        .set({ lastMessageAt: sentAt })
        .where(eq(conversation.id, conv.id));
    }

    return ok({
      conversationId: conv.id,
      messageId,
      created: messageId !== null,
    });
  } catch (error) {
    logError('conversations.ingestHistoricalMessage', error, {
      feature: 'conversations',
      extra: {
        pageId: parsed.data.pageId,
        externalUserId: parsed.data.externalUserId,
        externalMessageId: parsed.data.externalMessageId,
      },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to ingest historical message'
      )
    );
  }
};

export const ingestHistoricalMessage = (
  db: DbConnection,
  input: IngestHistoricalMessageInput
) =>
  trackedResult(
    'conversations.ingestHistoricalMessage',
    () => ingestHistoricalMessageImpl(db, input),
    {
      properties: {
        pageId: input.pageId,
        externalMessageId: input.externalMessageId,
        role: input.role,
      },
    }
  );

export type IngestHistoricalMessageResult = Awaited<
  ReturnType<typeof ingestHistoricalMessage>
>;
