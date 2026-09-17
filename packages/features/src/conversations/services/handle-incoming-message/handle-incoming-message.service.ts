import type { MessagingPlatform } from '@borradh-workspace/database';
import { conversation } from '@borradh-workspace/database';
import {
  createLogger,
  logError,
  redactPII,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';

const logger = createLogger('HandleIncomingMessage');
import {
  cancelPendingFollowUp,
  cancelPendingMessageParts,
  cancelResponseTimeout,
  queueChatbotFlow,
} from '../../../chatbots/services/queue-chatbot-flow/queue-chatbot-flow.service.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  logConversationEvent,
  ok,
} from '../../../shared/index.js';

import { advanceLeadStage } from '../../../leads/index.js';
import { importAdById } from '../../../meta-ads/services/import-ad-by-id/index.js';
import { createNewConversation } from './create-new-conversation.js';
import {
  type RawMetaMessage,
  deriveMessageContent,
  isEmptyMetaMessage,
} from './derive-message-content.js';
import {
  fetchInstagramSenderName,
  fetchSenderName,
} from './fetch-sender-profile.js';
import {
  type HandleIncomingMessageInput,
  handleIncomingMessageSchema,
} from './handle-incoming-message.schema.js';
import { consumePendingAdReferral } from './pending-ad-referral.js';
import { recordIncomingMessage } from './record-incoming-message.js';
import { resolveAdReferral } from './resolve-ad-referral.js';
import {
  resolveInstagramContext,
  resolveMessengerContext,
  resolveSmsContext,
  resolveWhatsAppChatbot,
} from './resolve-message-context.js';
import { updateExistingConversation } from './update-existing-conversation.js';

/**
 * Resolve sender name from Meta APIs (only for Messenger/Instagram platforms with a page token).
 */
async function resolveSenderName(
  // Every platform, not just the Meta ones: the guard below returns undefined
  // for anything without a profile API (WhatsApp, SMS), after honouring a name
  // the caller already knows.
  platform: MessagingPlatform,
  page: {
    pageAccessToken: string | null;
    pageId: string;
    metaAdsIntegrationId: string;
  } | null,
  senderId: string,
  providedName?: string
): Promise<string | undefined> {
  if (providedName) return providedName;
  if (!page?.pageAccessToken) return undefined;
  if (platform !== 'facebook_messenger' && platform !== 'instagram_dm')
    return undefined;

  // Skip non-numeric sender IDs (e.g. E2E simulate-webhook fixtures). Meta's
  // profile/conversations APIs require a numeric PSID/IGSID and respond with
  // opaque errors for anything else.
  if (!/^\d+$/.test(senderId)) return undefined;

  const isStandaloneInstagram = page.metaAdsIntegrationId === '';
  return isStandaloneInstagram
    ? await fetchInstagramSenderName(page.pageAccessToken, senderId)
    : await fetchSenderName(page, senderId, platform);
}

const handleIncomingMessageImpl = async (
  db: DbConnection,
  input: HandleIncomingMessageInput
): Promise<Result<{ conversationId: string; messageId: string }>> => {
  const parsed = handleIncomingMessageSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    // 0. Derive the persisted/display form of this message up-front. Stickers,
    //    emoji reactions and image/file attachments arrive with empty text;
    //    deriveMessageContent gives a never-blank label + structured metadata,
    //    and isEmptyMetaMessage distinguishes a real non-text message from a
    //    read-receipt / typing / reaction-removed event we should skip.
    const rawMessage: RawMetaMessage = {
      text: parsed.data.messageText,
      attachments: parsed.data.attachments,
      stickerId: parsed.data.stickerId,
      reaction: parsed.data.reaction,
    };
    const derived = deriveMessageContent(rawMessage);
    const isEmptyMessage = isEmptyMetaMessage(rawMessage);
    // Only a real text body should trigger the AI flow — a bare sticker/photo
    // is recorded for the inbox but must not push a text response.
    const hasText = !!parsed.data.messageText?.trim();

    // 1. Resolve page/chatbot context (platform-specific)
    let resolved:
      | Awaited<ReturnType<typeof resolveMessengerContext>>
      | Awaited<ReturnType<typeof resolveInstagramContext>>
      | Awaited<ReturnType<typeof resolveWhatsAppChatbot>>
      | Awaited<ReturnType<typeof resolveSmsContext>>;

    switch (parsed.data.platform) {
      case 'facebook_messenger':
        resolved = await resolveMessengerContext(db, parsed.data.pageId);
        break;
      case 'instagram_dm':
        resolved = await resolveInstagramContext(db, parsed.data.pageId);
        break;
      case 'whatsapp':
        resolved = await resolveWhatsAppChatbot(db, parsed.data.pageId);
        break;
      case 'sms':
        // `pageId` is the receiving number; the sender is needed to attribute
        // a shared number to the right org.
        resolved = await resolveSmsContext(
          db,
          parsed.data.pageId,
          parsed.data.senderId
        );
        break;
    }

    if (!resolved) {
      return err(
        new FeatureError(
          ErrorCodes.NOT_FOUND,
          `No integration found for ${parsed.data.platform} page ${parsed.data.pageId}`
        )
      );
    }

    const {
      isChatbotActive,
      organizationId,
      metaAdsPageId,
      whatsappAccountId,
      page,
    } = resolved;

    logger.info('Resolved routing context', {
      reason: 'inbound_resolved',
      pageId: parsed.data.pageId,
      platform: parsed.data.platform,
      organizationId,
      metaAdsPageId,
      isChatbotActive,
      debug: {
        senderId: parsed.data.senderId,
        messagePreview: redactPII(parsed.data.messageText ?? '').slice(0, 300),
        hasMessageText: !!parsed.data.messageText?.trim(),
        adReferralId: parsed.data.adReferral?.metaAdId ?? null,
        skipExternalDelivery: !!parsed.data.skipExternalDelivery,
      },
    });

    if (!isChatbotActive && parsed.data.platform !== 'whatsapp') {
      logger.info('No active chatbot, will create agent-handled conversation', {
        reason: 'chatbot_disabled_for_page',
        pageId: parsed.data.pageId,
        platform: parsed.data.platform,
        organizationId,
      });
    }

    // 2. Resolve ad referral metadata.
    //    If the message itself doesn't carry referral data, check Redis
    //    for a pending referral stored by a standalone referral event
    //    (Meta sends these before the user's first message on ad clicks).
    let adReferralInput = parsed.data.adReferral;
    if (!adReferralInput) {
      const pending = await consumePendingAdReferral(
        parsed.data.pageId,
        parsed.data.senderId,
        parsed.data.platform
      );
      if (pending) {
        adReferralInput = pending;
      }
    }
    const adReferral = await resolveAdReferral(db, adReferralInput, {
      onMissingAd: (metaAdId) =>
        importAdById(db, { organizationId, metaAdId }).then((r) =>
          r.success ? r.data.internalAdId : null
        ),
    });

    // 3. Find or create conversation.
    //    Lead vs. friends/family/returning-client/spam triage is no longer a
    //    crude "have we seen this PSID" gate — Claire classifies every inbound
    //    semantically (MESSAGE CLASSIFICATION in the AI prompt) and silently
    //    hands non-leads to the owner. So the bot activates whenever the page's
    //    chatbot is on; the classifier decides whether to actually respond.
    let conv = await db.query.conversation.findFirst({
      where: and(
        eq(conversation.organizationId, organizationId),
        eq(conversation.externalUserId, parsed.data.senderId),
        eq(conversation.platform, parsed.data.platform)
      ),
    });

    if (conv) {
      // Only fetch sender name if conversation doesn't have one yet
      const senderName = !conv.externalUserName
        ? await resolveSenderName(
            parsed.data.platform,
            page,
            parsed.data.senderId,
            parsed.data.senderName
          )
        : undefined;

      conv = await updateExistingConversation(db, conv, {
        isChatbotActive,
        metaAdsPageId,
        whatsappAccountId,
        senderName,
        adReferral,
      });
    } else {
      // Don't create new conversations for truly empty events (read receipts,
      // typing, reaction-removed). Stickers/photos/emoji DO create one so the
      // contact is visible in the inbox.
      if (isEmptyMessage) {
        logger.info(
          'Skipping empty message — no existing conversation to attach to',
          {
            reason: 'empty_message_new_conv_skipped',
            organizationId,
            platform: parsed.data.platform,
            senderId: parsed.data.senderId,
          }
        );
        return ok({ conversationId: '', messageId: '' });
      }

      conv = await createNewConversation(db, {
        organizationId,
        externalUserId: parsed.data.senderId,
        platform: parsed.data.platform,
        isChatbotActive,
        metaAdsPageId,
        whatsappAccountId,
        page: page
          ? {
              pageAccessToken: page.pageAccessToken,
              pageId: page.pageId,
              metaAdsIntegrationId: page.metaAdsIntegrationId,
            }
          : null,
        senderName: parsed.data.senderName,
        adReferral,
        externalConversationId: parsed.data.messageId,
      });
    }

    // 5. Skip only truly empty events (read receipts, typing). A sticker,
    //    photo or emoji reaction is recorded so it shows in the inbox.
    if (isEmptyMessage) {
      logger.info('Skipping empty message on existing conversation', {
        reason: 'empty_message_existing_conv_skipped',
        conversationId: conv.id,
        organizationId,
        platform: parsed.data.platform,
      });
      return ok({ conversationId: conv.id, messageId: '' });
    }

    // 6. Record incoming message (dedup via externalMessageId). Non-text
    //    messages carry a never-blank label + structured metadata.
    const message = await recordIncomingMessage(db, {
      conversationId: conv.id,
      externalMessageId: parsed.data.messageId,
      content: derived.content,
      messageType: derived.messageType,
      metadata: derived.metadata,
      timestamp: parsed.data.timestamp,
    });

    // 7. Update last message timestamp
    await db
      .update(conversation)
      .set({ lastMessageAt: new Date() })
      .where(eq(conversation.id, conv.id));

    // The lead answered. That is the signal that separates "we messaged them"
    // from "they're interested", so it is the one that moves the stage. Only
    // advances — a lead a human has already moved on is left alone.
    const linkedLeadId = (conv.metadata as { leadId?: string } | null)?.leadId;
    if (linkedLeadId) {
      await advanceLeadStage(db, {
        leadId: linkedLeadId,
        from: 'contacted',
        to: 'qualified',
      });
    }

    // Durable trail: the inbound message landed on a conversation in <status>.
    await logConversationEvent(db, {
      organizationId,
      conversationId: conv.id,
      event: 'inbound_received',
      metadata: {
        platform: parsed.data.platform,
        status: conv.status,
        hasText,
        messageType: derived.messageType,
        isChatbotActive,
        fromAd: !!adReferral?.adMetaId,
      },
    });

    // 8. If agent_handling, just record - agent sees it in inbox
    if (conv.status === 'agent_handling') {
      logger.info(
        'Existing conversation is agent_handling, recording message but bypassing bot',
        {
          reason: 'agent_handling_short_circuit',
          conversationId: conv.id,
          organizationId,
          platform: parsed.data.platform,
        }
      );
      await logConversationEvent(db, {
        organizationId,
        conversationId: conv.id,
        event: 'bot_suppressed',
        metadata: {
          // Why the bot is not running on this conversation.
          reason: !isChatbotActive
            ? 'chatbot_disabled'
            : 'already_agent_handling',
          platform: parsed.data.platform,
        },
      });
      return ok({ conversationId: conv.id, messageId: message.id });
    }

    // 9. If bot_handling, queue flow execution — but only for real text. A
    //    lone sticker/photo is recorded above without pushing an AI response.
    if (conv.status === 'bot_handling' && hasText) {
      await cancelResponseTimeout(conv.id);
      await cancelPendingMessageParts(conv.id);
      await cancelPendingFollowUp(conv.id);
      await queueChatbotFlow({
        conversationId: conv.id,
        userMessage: parsed.data.messageText ?? undefined,
        triggerType: 'message',
        delayMs: parsed.data.queueDelayMs ?? 15_000,
        skipExternalDelivery: parsed.data.skipExternalDelivery,
      });
      await logConversationEvent(db, {
        organizationId,
        conversationId: conv.id,
        event: 'bot_queued',
        metadata: { platform: parsed.data.platform, triggerType: 'message' },
      });
    } else if (conv.status === 'bot_handling' && !hasText) {
      // Recorded for the inbox but no AI response — a lone sticker/photo/file.
      await logConversationEvent(db, {
        organizationId,
        conversationId: conv.id,
        event: 'bot_suppressed',
        metadata: {
          reason: 'non_text',
          messageType: derived.messageType,
          platform: parsed.data.platform,
        },
      });
    }

    return ok({ conversationId: conv.id, messageId: message.id });
  } catch (error) {
    logError('conversations.handleIncomingMessage', error, {
      feature: 'conversations',
      extra: {
        pageId: parsed.data.pageId,
        senderId: parsed.data.senderId,
      },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to handle incoming message'
      )
    );
  }
};

export const handleIncomingMessage = (
  db: DbConnection,
  input: HandleIncomingMessageInput
) =>
  trackedResult(
    'conversations.handleIncomingMessage',
    () => handleIncomingMessageImpl(db, input),
    {
      properties: {
        pageId: input.pageId,
        platform: input.platform,
      },
      // NOT_FOUND for webhooks from pages not mapped to any org is
      // expected; the caller already warn-logs those.
      internalErrorsOnly: true,
    }
  );

export type HandleIncomingMessageResult = Awaited<
  ReturnType<typeof handleIncomingMessage>
>;
