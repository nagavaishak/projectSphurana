import {
  conversation,
  conversationMessage,
  instagramIntegration,
  metaAdsPage,
  whatsappAccount,
} from '@borradh-workspace/database';
import { withOrgScope } from '@borradh-workspace/database';
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { MetaMessagingService } from '@borradh-workspace/integrations/meta-messaging';
import { WhatsAppCloudService } from '@borradh-workspace/integrations/whatsapp';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { logMetaErrorIfUnknown } from '../../../meta-ads/services/_shared/handle-meta-error.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  logConversationEvent,
  ok,
} from '../../../shared/index.js';
import {
  type SendMessageInput,
  sendMessageSchema,
} from './send-message.schema.js';

/**
 * Deliver a message to the external platform (Messenger, Instagram, WhatsApp).
 * Returns the external message ID on success, or null if delivery fails.
 */
async function deliverToPlatform(
  db: DbConnection,
  conv: typeof conversation.$inferSelect,
  content: string
): Promise<string | null> {
  try {
    if (
      conv.platform === 'facebook_messenger' ||
      conv.platform === 'instagram_dm'
    ) {
      let messenger: MetaMessagingService;

      // NOTE: platform gates the Facebook branch FIRST — see the matching
      // note in deliver-messages.ts. `metaAdsPageId` is a legacy FK that can
      // be stale/non-null on an Instagram DM conversation; branching on it
      // alone would send an IGSID to graph.facebook.com with a Facebook page
      // token (ENG-846).
      if (conv.platform === 'facebook_messenger' && conv.metaAdsPageId) {
        const page = await db.query.metaAdsPage.findFirst({
          where: eq(metaAdsPage.id, conv.metaAdsPageId),
        });
        if (!page?.pageAccessToken) return null;

        const decryptedToken = decryptCredentials<{ accessToken: string }>(
          page.pageAccessToken
        );
        messenger = new MetaMessagingService({
          pageAccessToken: decryptedToken.accessToken,
          pageId: page.pageId,
        });
      } else if (conv.platform === 'instagram_dm') {
        // Standalone Instagram - look up integration by org
        const igInteg = await db.query.instagramIntegration.findFirst({
          where: and(
            eq(instagramIntegration.organizationId, conv.organizationId),
            eq(instagramIntegration.isActive, true)
          ),
        });
        if (!igInteg?.encryptedCredentials) return null;

        const decryptedToken = decryptCredentials<{ accessToken: string }>(
          igInteg.encryptedCredentials
        );
        messenger = new MetaMessagingService({
          pageAccessToken: decryptedToken.accessToken,
          pageId: igInteg.instagramUserId || conv.externalUserId,
          graphApiBase: 'https://graph.instagram.com',
        });
      } else {
        return null;
      }

      const result = await messenger.sendTextMessage(
        conv.externalUserId,
        content
      );
      return result.messageId ?? null;
    }

    if (conv.platform === 'whatsapp') {
      // Prefer the specific account linked to this conversation,
      // fall back to any active account in the org
      const waAccount = conv.whatsappAccountId
        ? await db.query.whatsappAccount.findFirst({
            where: eq(whatsappAccount.id, conv.whatsappAccountId),
          })
        : await db.query.whatsappAccount.findFirst({
            where: and(
              eq(whatsappAccount.organizationId, conv.organizationId),
              eq(whatsappAccount.isActive, true)
            ),
          });
      if (!waAccount) return null;

      const credentials = decryptCredentials<{ accessToken: string }>(
        waAccount.encryptedCredentials
      );

      const whatsapp = new WhatsAppCloudService(
        credentials.accessToken,
        waAccount.phoneNumberId
      );

      const result = await whatsapp.sendTextMessage(
        conv.externalUserId,
        content
      );
      return result.messageId ?? null;
    }

    return null;
  } catch (error) {
    // Suppress known/expected Meta Graph API errors (24h window expired,
    // recipient blocked, template paused, etc.) — only log unclassified
    // errors as Sentry-worthy bugs. Applies to Messenger, Instagram, and
    // WhatsApp since all three throw MetaApiError now that whatsapp-cloud
    // routes through parseMetaErrorResponse.
    logMetaErrorIfUnknown(
      'conversations.deliverToPlatform',
      error,
      {
        conversationId: conv.id,
        platform: conv.platform,
      },
      'conversations'
    );
    // Don't fail the whole operation — message is saved in DB
    return null;
  }
}

const sendMessageImpl = async (
  db: DbConnection,
  input: SendMessageInput
): Promise<Result<typeof conversationMessage.$inferSelect>> => {
  const parsed = sendMessageSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Verify conversation exists and belongs to organization
  const conv = await db.query.conversation.findFirst({
    where: and(
      eq(conversation.id, parsed.data.conversationId),
      eq(conversation.organizationId, parsed.data.organizationId)
    ),
  });

  if (!conv) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Conversation not found')
    );
  }

  try {
    // Record message in database
    const [message] = await db
      .insert(conversationMessage)
      .values({
        conversationId: parsed.data.conversationId,
        role: 'agent',
        content: parsed.data.content,
        messageType: 'text',
        sentAt: new Date(),
      })
      .returning();

    // Update conversation status and last message time
    await db
      .update(conversation)
      .set({
        status: 'agent_handling',
        lastMessageAt: new Date(),
        assignedToId: parsed.data.userId,
      })
      .where(eq(conversation.id, parsed.data.conversationId));

    // A human agent replied from the dashboard — Claire stands down.
    await logConversationEvent(db, {
      organizationId: parsed.data.organizationId,
      conversationId: parsed.data.conversationId,
      event: 'agent_takeover',
      metadata: { via: 'dashboard', userId: parsed.data.userId },
    });

    // Deliver message to external platform (non-blocking for the response)
    const externalMessageId = await deliverToPlatform(
      db,
      conv,
      parsed.data.content
    );

    // Store external message ID if delivery succeeded
    if (externalMessageId) {
      await db
        .update(conversationMessage)
        .set({ externalMessageId })
        .where(eq(conversationMessage.id, message.id));
    }

    return ok(message);
  } catch (error) {
    logError('conversations.sendMessage', error, {
      feature: 'conversations',
      extra: { conversationId: parsed.data.conversationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to send message')
    );
  }
};

export const sendMessage = (db: DbConnection, input: SendMessageInput) =>
  trackedResult(
    'conversations.sendMessage',
    () => withOrgScope((tx) => sendMessageImpl(tx, input), { db }),
    {
      properties: { conversationId: input.conversationId },
    }
  );

export type SendMessageResult = Awaited<ReturnType<typeof sendMessage>>;
