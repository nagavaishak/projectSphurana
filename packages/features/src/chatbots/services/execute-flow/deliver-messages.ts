import {
  conversation,
  conversationMessage,
  instagramIntegration,
  metaAdsPage,
  orgSmsNumber,
  orgSmsSender,
  organization,
  whatsappAccount,
} from '@borradh-workspace/database';
import type { ConversationMetadata } from '@borradh-workspace/database';
import {
  MetaApiError,
  extractMetaErrorContext,
} from '@borradh-workspace/integrations';
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { MetaMessagingService } from '@borradh-workspace/integrations/meta-messaging';
import { TwilioSMSService } from '@borradh-workspace/integrations/sms';
import { WhatsAppCloudService } from '@borradh-workspace/integrations/whatsapp';
import { createLogger, logError } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { resolveSmsSender } from '../../../campaigns/index.js';
import {
  handleMetaAuthError,
  metaTypeForPlatform,
} from '../../../integrations/services/mark-needs-reconnect/mark-needs-reconnect.service.js';
import {
  type DbConnection,
  logConversationEvent,
} from '../../../shared/index.js';
import type { FlowMessage } from './execute-flow.schema.js';

const logger = createLogger('DeliverMessages');

/**
 * Pacing delay between consecutive messages, scaled to message length.
 * 200ms base + 10ms per character, capped at 2000ms.
 */
function pacingDelay(text?: string): number {
  const base = 200;
  const perChar = 10;
  const max = 2000;
  const length = text?.length ?? 0;
  return Math.min(base + length * perChar, max);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/*
 * NOTE — no typing indicator on the Meta path, deliberately.
 *
 * We used to bracket each message with `sender_action: typing_on` / `typing_off`.
 * `typing_off` was wrapped in a try/catch; `typing_on` was raised INSIDE the
 * delivery try. That asymmetry made a cosmetic courtesy call able to abort the
 * customer's actual reply: the throw skipped `sendTextMessage` entirely, and
 * because subcode 2018048 was registered as `not_found` we then marked the
 * recipient unreachable, stopped sending, and escalated to a human.
 *
 * From 2026-07-28 Meta began refusing `sender_action` at scale —
 * `(#100) Sender action failed` — against recipients who were demonstrably
 * reachable (10 of the first 21 received a message from the same Page within
 * six hours, one within 39 seconds). By 2026-08-01 it was refusing roughly one
 * in five Messenger replies.
 *
 * The indicator bought a sub-two-second bubble and an extra API round-trip per
 * message. It is not worth a failure surface, so it is gone. The pacing
 * `sleep` below is kept — it staggers multi-message replies so they don't all
 * land at once. If it is ever restored, it MUST sit outside the delivery
 * try/catch.
 */

interface DeliverMessagesInput {
  db: DbConnection;
  conversationId: string;
  messages: FlowMessage[];
  /** When true, save bot messages to DB without calling external APIs (for E2E testing) */
  skipExternalDelivery?: boolean;
}

/**
 * Outcome of a delivery attempt so callers can tell whether the customer
 * actually received the reply. Previously delivery was fire-and-forget
 * (returned void), which let a failed external send be treated as success —
 * the flow still stamped `lastBotResponseAt` and scheduled follow-ups even
 * though the lead received nothing (Messenger lead-form silent-no-reply bug).
 */
export interface DeliveryOutcome {
  /** Customer-facing messages we tried to send externally. */
  attempted: number;
  /** Messages confirmed sent to the external platform. */
  delivered: number;
  /** Messages whose external send threw (nothing reached the customer). */
  failed: number;
  /**
   * Human-readable detail of WHY delivery failed, when the recipient itself
   * is unreachable (Meta `not_found` / `user_blocked`). Callers can fold this
   * into an escalation's `reasonDetail` instead of a generic string.
   */
  unavailableReason?: string;
}

const noopOutcome = (attempted = 0): DeliveryOutcome => ({
  attempted,
  delivered: 0,
  failed: attempted,
});

/**
 * Deliver accumulated flow messages to the external platform and record them in DB.
 *
 * Uses the same decrypt-token-then-send pattern as send-message.service.ts.
 * Returns a {@link DeliveryOutcome} so callers can gate success-side effects
 * (metadata stamps, follow-up scheduling) on whether anything was delivered.
 */
export async function deliverMessages({
  db,
  conversationId,
  messages,
  skipExternalDelivery,
}: DeliverMessagesInput): Promise<DeliveryOutcome> {
  if (messages.length === 0) return noopOutcome(0);

  // Load conversation to get external user ID and page reference
  const conv = await db.query.conversation.findFirst({
    where: eq(conversation.id, conversationId),
  });

  if (!conv) {
    logger.warn('Conversation not found for delivery', { conversationId });
    return noopOutcome(messages.length);
  }

  // Skip external API calls and save directly to DB (for E2E testing)
  if (skipExternalDelivery) {
    for (const msg of messages) {
      const content = msg.text ?? '';
      const messageType = msg.type === 'quick_reply' ? 'quick_reply' : 'text';
      const messageMetadata =
        msg.type === 'quick_reply' && msg.quickReplyOptions
          ? { options: msg.quickReplyOptions }
          : null;

      await db.insert(conversationMessage).values({
        conversationId,
        role: 'bot',
        content,
        messageType,
        externalMessageId: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        metadata: messageMetadata,
        sentAt: new Date(),
      });
    }
    return {
      attempted: messages.length,
      delivered: messages.length,
      failed: 0,
    };
  }

  // Deliver via platform-specific service
  if (conv.platform === 'whatsapp') {
    return deliverViaWhatsApp({ db, conv, conversationId, messages });
  }
  if (conv.platform === 'sms') {
    return deliverViaSms({ db, conv, conversationId, messages });
  }
  return deliverViaMeta({ db, conv, conversationId, messages });
}

/**
 * Deliver messages via Facebook Messenger or Instagram DM.
 */
async function deliverViaMeta({
  db,
  conv,
  conversationId,
  messages,
}: {
  db: DbConnection;
  conv: typeof conversation.$inferSelect;
  conversationId: string;
  messages: FlowMessage[];
}): Promise<DeliveryOutcome> {
  let messenger: MetaMessagingService;
  let delivered = 0;
  let failed = 0;

  // NOTE: platform gates the Facebook branch FIRST. `metaAdsPageId` is a
  // legacy FK left over from before the page-pin was re-pointed correctly
  // (ENG-846) — an Instagram DM conversation can carry a stale non-null
  // `metaAdsPageId` and must still resolve via the Instagram integration.
  // Branching on `metaAdsPageId` alone would send an IGSID to
  // graph.facebook.com with a Facebook page token.
  if (conv.platform === 'facebook_messenger' && conv.metaAdsPageId) {
    // Standard Meta Ads page path
    const page = await db.query.metaAdsPage.findFirst({
      where: eq(metaAdsPage.id, conv.metaAdsPageId),
    });

    if (!page?.pageAccessToken) {
      logger.warn('No page access token for delivery', {
        conversationId,
        pageId: conv.metaAdsPageId,
      });
      return noopOutcome(messages.length);
    }

    try {
      const decryptedToken = decryptCredentials<{ accessToken: string }>(
        page.pageAccessToken
      );
      messenger = new MetaMessagingService({
        pageAccessToken: decryptedToken.accessToken,
        pageId: page.pageId,
      });
    } catch (error) {
      logError('chatbots.deliverMessages.decrypt', error, {
        feature: 'chatbots',
        extra: { conversationId, pageId: page.id },
      });
      return noopOutcome(messages.length);
    }
  } else if (conv.platform === 'instagram_dm') {
    // Standalone Instagram path - look up integration by org
    const igIntegration = await db.query.instagramIntegration.findFirst({
      where: and(
        eq(instagramIntegration.organizationId, conv.organizationId),
        eq(instagramIntegration.isActive, true)
      ),
    });

    if (!igIntegration?.encryptedCredentials) {
      logger.warn('No Instagram integration for delivery', {
        conversationId,
        organizationId: conv.organizationId,
      });
      return noopOutcome(messages.length);
    }

    try {
      const decryptedToken = decryptCredentials<{ accessToken: string }>(
        igIntegration.encryptedCredentials
      );
      messenger = new MetaMessagingService({
        pageAccessToken: decryptedToken.accessToken,
        pageId: igIntegration.instagramUserId || conv.externalUserId,
        graphApiBase: 'https://graph.instagram.com',
      });
    } catch (error) {
      logError('chatbots.deliverMessages.decrypt', error, {
        feature: 'chatbots',
        extra: { conversationId, integrationId: igIntegration.id },
      });
      return noopOutcome(messages.length);
    }
  } else {
    logger.warn('No page linked to conversation', { conversationId });
    return noopOutcome(messages.length);
  }

  // Set once, when the loop breaks on an unreachable recipient — folded into
  // the returned DeliveryOutcome so callers can attach a specific reason to
  // whatever escalation/handoff they raise instead of a generic string.
  let deliveryUnavailableReason: string | undefined;

  for (const msg of messages) {
    let externalMessageId: string | null = null;
    let messageType: 'text' | 'quick_reply' | 'image' | 'attachment' = 'text';
    let content = msg.text ?? '';
    let messageMetadata: Record<string, unknown> | undefined;
    let recipientNotFound = false;
    let deliverySucceeded = false;

    // 1. Pace multi-message replies so they don't all land at once.
    await sleep(pacingDelay(msg.text));

    // 2. Attempt external delivery (Meta/Instagram/WhatsApp API)
    try {
      if (msg.type === 'text' && msg.text) {
        const result = await messenger.sendTextMessage(
          conv.externalUserId,
          msg.text
        );
        externalMessageId = result.messageId || null;
        messageType = 'text';
        deliverySucceeded = true;
      } else if (
        msg.type === 'quick_reply' &&
        msg.text &&
        msg.quickReplyOptions
      ) {
        const result = await messenger.sendQuickReply(
          conv.externalUserId,
          msg.text,
          msg.quickReplyOptions.map((opt) => ({
            contentType: 'text' as const,
            title: opt.label,
            payload: opt.value,
          }))
        );
        externalMessageId = result.messageId || null;
        messageType = 'quick_reply';
        messageMetadata = { options: msg.quickReplyOptions };
        deliverySucceeded = true;
      } else if (msg.type === 'media' && msg.mediaUrl && msg.mediaType) {
        const result = await messenger.sendAttachment(
          conv.externalUserId,
          msg.mediaType,
          msg.mediaUrl
        );
        externalMessageId = result.messageId || null;
        messageType = 'attachment';
        content = msg.mediaUrl;
        deliverySucceeded = true;
      } else {
        // No branch matched — the message shape was incomplete (empty
        // text, missing quick-reply options, missing media url). Previously
        // a silent abstain; now logged so we can attribute "bot went
        // silent" to delivery rather than guess at causes.
        logger.warn(
          'Message skipped during Meta delivery (no matching branch)',
          {
            reason: 'delivery_no_branch_match',
            conversationId,
            platform: conv.platform,
            messageType: msg.type,
            hasText: !!msg.text?.trim(),
            hasQuickReplyOptions: !!msg.quickReplyOptions?.length,
            hasMediaUrl: !!msg.mediaUrl,
          }
        );
      }
    } catch (error) {
      failed++;
      const metaErr = error instanceof MetaApiError ? error : undefined;
      const isUnavailableRecipientError =
        !!metaErr &&
        (metaErr.category === 'not_found' ||
          metaErr.category === 'user_blocked');

      const metaContext = extractMetaErrorContext(error);

      // `isExpected` conditions (recipient not found, blocked, auth required,
      // etc.) are known, non-bug outcomes driven by the recipient/Meta policy
      // — log at warn so they don't trip infra error alerts. Everything else
      // (transient/rate_limited/unknown) is still Sentry-worthy: this logger
      // lives in a feature package that doesn't ship to BetterStack, so
      // Messenger lead-form leads could otherwise silently receive nothing
      // with no trace of why.
      const logExtra = {
        conversationId,
        organizationId: conv.organizationId,
        platform: conv.platform,
        messageType: msg.type,
        unavailableRecipient: isUnavailableRecipientError,
        ...metaContext,
      };
      if (metaErr?.isExpected) {
        logger.warn('Meta delivery failed (expected condition)', logExtra);
      } else {
        logError('chatbots.deliverMessages.send', error, {
          feature: 'chatbots',
          extra: logExtra,
        });
      }
      // A dead/revoked token (Meta error 190) surfaces here as a send failure
      // — flag the integration needs_reconnect so the org is prompted to
      // reconnect instead of silently dropping every reply.
      await handleMetaAuthError(db, error, {
        type: metaTypeForPlatform(conv.platform),
        organizationId: conv.organizationId,
      });
      // Durable audit trail + PostHog analytics for the failed delivery.
      await logConversationEvent(db, {
        organizationId: conv.organizationId,
        conversationId,
        event: 'delivery_failed',
        metadata: {
          platform: conv.platform,
          messageType: msg.type,
          unavailableRecipient: isUnavailableRecipientError,
          ...metaContext,
        },
      });

      if (isUnavailableRecipientError && metaErr) {
        logger.warn(
          'Recipient unavailable, will stop further delivery attempts',
          {
            conversationId,
            externalUserId: conv.externalUserId,
            category: metaErr.category,
          }
        );
        recipientNotFound = true;
        deliveryUnavailableReason = `Recipient unreachable (Meta ${metaErr.category}${
          metaErr.code !== undefined ? ` code ${metaErr.code}` : ''
        }${metaErr.subcode !== undefined ? `/${metaErr.subcode}` : ''})`;

        // Durable marker on the conversation so a later trigger (follow_up,
        // timeout, a stray new job) doesn't re-attempt delivery and re-log
        // the same failure. Cleared only by a genuinely new inbound message
        // from this recipient (see process-chatbot-flow-job.service.ts) —
        // that is the one signal that proves they are reachable again.
        try {
          const existingMetadata =
            (conv.metadata as ConversationMetadata | null) ?? {};
          await db
            .update(conversation)
            .set({
              metadata: {
                ...existingMetadata,
                undeliverable: {
                  at: new Date().toISOString(),
                  code: metaErr.code,
                  subcode: metaErr.subcode,
                  category: metaErr.category,
                  pageId: conv.metaAdsPageId ?? undefined,
                },
              },
            })
            .where(eq(conversation.id, conversationId));
        } catch (metaUpdateError) {
          logError(
            'chatbots.deliverMessages.markUndeliverable',
            metaUpdateError,
            {
              feature: 'chatbots',
              extra: { conversationId },
            }
          );
        }
      }
    }

    // 3. Log if delivery succeeded but no messageId (don't retry — causes duplicate messages)
    if (deliverySucceeded && !externalMessageId) {
      logError(
        'chatbots.deliverMessages.missingMessageId',
        new Error('Message delivered but no external ID captured'),
        {
          feature: 'chatbots',
          extra: {
            conversationId,
            messageType: msg.type,
            platform: conv.platform,
          },
        }
      );
    }

    // 4. Only persist if delivery succeeded — ghost messages with null IDs
    //    corrupt conversation history and break sync deduplication.
    if (deliverySucceeded) {
      delivered++;
      try {
        await db.insert(conversationMessage).values({
          conversationId,
          role: 'bot',
          content,
          messageType,
          externalMessageId,
          metadata: messageMetadata ?? null,
          sentAt: new Date(),
        });
      } catch (dbError) {
        logError('chatbots.deliverMessages.dbInsert', dbError, {
          feature: 'chatbots',
          extra: { conversationId },
        });
      }
    }

    // If the user no longer exists, stop trying to send remaining messages
    if (recipientNotFound) {
      break;
    }
  }

  return {
    attempted: messages.length,
    delivered,
    failed,
    unavailableReason: deliveryUnavailableReason,
  };
}

/**
 * Deliver messages via WhatsApp Cloud API.
 */
async function deliverViaWhatsApp({
  db,
  conv,
  conversationId,
  messages,
}: {
  db: DbConnection;
  conv: typeof conversation.$inferSelect;
  conversationId: string;
  messages: FlowMessage[];
}): Promise<DeliveryOutcome> {
  let delivered = 0;
  let failed = 0;

  if (!conv.whatsappAccountId) {
    logger.warn('No WhatsApp account linked to conversation', {
      conversationId,
    });
    return noopOutcome(messages.length);
  }

  const waAccount = await db.query.whatsappAccount.findFirst({
    where: eq(whatsappAccount.id, conv.whatsappAccountId),
  });

  if (!waAccount) {
    logger.warn('WhatsApp account not found for delivery', {
      conversationId,
      whatsappAccountId: conv.whatsappAccountId,
    });
    return noopOutcome(messages.length);
  }

  let whatsapp: WhatsAppCloudService;
  try {
    const credentials = decryptCredentials<{ accessToken: string }>(
      waAccount.encryptedCredentials
    );
    whatsapp = new WhatsAppCloudService(
      credentials.accessToken,
      waAccount.phoneNumberId
    );
  } catch (error) {
    logError('chatbots.deliverMessages.decrypt', error, {
      feature: 'chatbots',
      extra: { conversationId, whatsappAccountId: waAccount.id },
    });
    return noopOutcome(messages.length);
  }

  for (const msg of messages) {
    try {
      await sleep(pacingDelay(msg.text));

      let externalMessageId: string | null = null;
      let messageType: 'text' | 'quick_reply' | 'image' | 'attachment' = 'text';
      let content = msg.text ?? '';
      let messageMetadata: Record<string, unknown> | undefined;

      if (msg.type === 'text' && msg.text) {
        const result = await whatsapp.sendTextMessage(
          conv.externalUserId,
          msg.text
        );
        externalMessageId = result.messageId || null;
        messageType = 'text';
      } else if (
        msg.type === 'quick_reply' &&
        msg.text &&
        msg.quickReplyOptions
      ) {
        // WhatsApp doesn't support quick replies natively — send as numbered list
        const optionsList = msg.quickReplyOptions
          .map((opt, i) => `${i + 1}. ${opt.label}`)
          .join('\n');
        const fullText = `${msg.text}\n\n${optionsList}`;
        const result = await whatsapp.sendTextMessage(
          conv.externalUserId,
          fullText
        );
        externalMessageId = result.messageId || null;
        messageType = 'quick_reply';
        content = fullText;
        messageMetadata = { options: msg.quickReplyOptions };
      } else if (msg.type === 'media') {
        // Media not supported yet — send text fallback
        const fallback = msg.text || '[Media attachment]';
        const result = await whatsapp.sendTextMessage(
          conv.externalUserId,
          fallback
        );
        externalMessageId = result.messageId || null;
        messageType = 'text';
        content = fallback;
      } else {
        // No branch matched — same silent-abstain surface as Meta path.
        logger.warn(
          'Message skipped during WhatsApp delivery (no matching branch)',
          {
            reason: 'delivery_no_branch_match',
            conversationId,
            platform: 'whatsapp',
            messageType: msg.type,
            hasText: !!msg.text?.trim(),
            hasQuickReplyOptions: !!msg.quickReplyOptions?.length,
            hasMediaUrl: !!msg.mediaUrl,
          }
        );
        continue;
      }

      if (!externalMessageId) {
        logError(
          'chatbots.deliverMessages.missingMessageId',
          new Error('WhatsApp message delivered but no external ID captured'),
          {
            feature: 'chatbots',
            extra: {
              conversationId,
              messageType: msg.type,
              platform: 'whatsapp',
            },
          }
        );
      }

      await db.insert(conversationMessage).values({
        conversationId,
        role: 'bot',
        content,
        messageType,
        externalMessageId,
        metadata: messageMetadata ?? null,
        sentAt: new Date(),
      });
      delivered++;
    } catch (error) {
      failed++;
      const metaContext = extractMetaErrorContext(error);
      logError('chatbots.deliverMessages.send', error, {
        feature: 'chatbots',
        extra: {
          conversationId,
          organizationId: conv.organizationId,
          platform: 'whatsapp',
          messageType: msg.type,
          ...metaContext,
        },
      });
      await handleMetaAuthError(db, error, {
        type: 'whatsapp',
        organizationId: conv.organizationId,
      });
      await logConversationEvent(db, {
        organizationId: conv.organizationId,
        conversationId,
        event: 'delivery_failed',
        metadata: {
          platform: 'whatsapp',
          messageType: msg.type,
          ...metaContext,
        },
      });
    }
  }

  return { attempted: messages.length, delivered, failed };
}

/**
 * Deliver messages via SMS (Twilio).
 *
 * Unlike the Meta and WhatsApp paths there is no per-conversation account to
 * decrypt — the sender is the org's configured SMS identity, resolved the same
 * way campaigns resolve it so the two never disagree about which number an org
 * sends from.
 *
 * SMS carries no rich types: quick replies degrade to a numbered list (as on
 * WhatsApp) and media degrades to its text fallback.
 */
async function deliverViaSms({
  db,
  conv,
  conversationId,
  messages,
}: {
  db: DbConnection;
  conv: typeof conversation.$inferSelect;
  conversationId: string;
  messages: FlowMessage[];
}): Promise<DeliveryOutcome> {
  let delivered = 0;
  let failed = 0;

  const [senderRow, numberRow, org] = await Promise.all([
    db.query.orgSmsSender.findFirst({
      where: eq(orgSmsSender.organizationId, conv.organizationId),
    }),
    db.query.orgSmsNumber.findFirst({
      where: eq(orgSmsNumber.organizationId, conv.organizationId),
    }),
    db.query.organization.findFirst({
      where: eq(organization.id, conv.organizationId),
    }),
  ]);

  const sender = resolveSmsSender({
    sender: senderRow ?? null,
    number: numberRow ?? null,
    orgName: org?.name ?? '',
  });

  // An alphanumeric sender ID has no address behind it, so the lead can never
  // reply — a two-way conversation on one is a configuration bug, not a
  // degraded experience. Refuse loudly rather than send into a void.
  if (sender.mode !== 'number') {
    logError(
      'chatbots.deliverMessages.smsSenderNotTwoWay',
      new Error(
        sender.mode === 'alpha'
          ? 'Conversation is on SMS but the org sends from a one-way alphanumeric sender ID'
          : `Conversation is on SMS but the org has no sendable SMS sender: ${sender.reason}`
      ),
      {
        feature: 'chatbots',
        extra: {
          conversationId,
          organizationId: conv.organizationId,
          senderMode: sender.mode,
        },
      }
    );
    return noopOutcome(messages.length);
  }

  let twilio: TwilioSMSService;
  try {
    twilio = new TwilioSMSService();
  } catch (error) {
    logError('chatbots.deliverMessages.twilioInit', error, {
      feature: 'chatbots',
      extra: { conversationId, organizationId: conv.organizationId },
    });
    return noopOutcome(messages.length);
  }

  for (const msg of messages) {
    try {
      await sleep(pacingDelay(msg.text));

      let messageType: 'text' | 'quick_reply' | 'image' | 'attachment' = 'text';
      let content = msg.text ?? '';
      let messageMetadata: Record<string, unknown> | undefined;

      if (msg.type === 'text' && msg.text) {
        content = msg.text;
      } else if (
        msg.type === 'quick_reply' &&
        msg.text &&
        msg.quickReplyOptions
      ) {
        const optionsList = msg.quickReplyOptions
          .map((opt, i) => `${i + 1}. ${opt.label}`)
          .join('\n');
        content = `${msg.text}\n\n${optionsList}`;
        messageType = 'quick_reply';
        messageMetadata = { options: msg.quickReplyOptions };
      } else if (msg.type === 'media') {
        content = msg.text || '[Media attachment]';
      } else {
        // No branch matched — same silent-abstain surface as the other paths.
        logger.warn(
          'Message skipped during SMS delivery (no matching branch)',
          {
            reason: 'delivery_no_branch_match',
            conversationId,
            platform: 'sms',
            messageType: msg.type,
            hasText: !!msg.text?.trim(),
            hasQuickReplyOptions: !!msg.quickReplyOptions?.length,
            hasMediaUrl: !!msg.mediaUrl,
          }
        );
        continue;
      }

      const result = await twilio.sendSMS({
        to: conv.externalUserId,
        body: content,
        from: sender.phoneNumber,
      });

      // Twilio reports send failures in the result rather than throwing, so an
      // unsuccessful send must be counted as failed here — not fall through to
      // the DB insert and look delivered.
      if (!result.success) {
        failed++;
        logError(
          'chatbots.deliverMessages.send',
          new Error(result.error ?? 'SMS send failed'),
          {
            feature: 'chatbots',
            extra: {
              conversationId,
              organizationId: conv.organizationId,
              platform: 'sms',
              messageType: msg.type,
            },
          }
        );
        await logConversationEvent(db, {
          organizationId: conv.organizationId,
          conversationId,
          event: 'delivery_failed',
          metadata: {
            platform: 'sms',
            messageType: msg.type,
            error: result.error,
          },
        });
        continue;
      }

      await db.insert(conversationMessage).values({
        conversationId,
        role: 'bot',
        content,
        messageType,
        externalMessageId: result.messageId || null,
        metadata: messageMetadata ?? null,
        sentAt: new Date(),
      });
      delivered++;
    } catch (error) {
      failed++;
      logError('chatbots.deliverMessages.send', error, {
        feature: 'chatbots',
        extra: {
          conversationId,
          organizationId: conv.organizationId,
          platform: 'sms',
          messageType: msg.type,
        },
      });
      await logConversationEvent(db, {
        organizationId: conv.organizationId,
        conversationId,
        event: 'delivery_failed',
        metadata: { platform: 'sms', messageType: msg.type },
      });
    }
  }

  return { attempted: messages.length, delivered, failed };
}
