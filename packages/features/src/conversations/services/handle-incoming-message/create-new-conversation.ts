import { conversation, conversationMessage } from '@borradh-workspace/database';
import type {
  ConversationMetadata,
  MessagingPlatform,
} from '@borradh-workspace/database';
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { MetaMessagingService } from '@borradh-workspace/integrations/meta-messaging';
import {
  createLogger,
  logError,
  trackOrgEvent,
} from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';

import {
  type DbConnection,
  logConversationEvent,
} from '../../../shared/index.js';
import { resolveConversationBranch } from '../../shared/resolve-conversation-branch.js';
import { linkOrCreateConversationLead } from './create-conversation-lead.js';
import {
  deriveMessageContent,
  metaHistoryToRaw,
} from './derive-message-content.js';
import {
  fetchInstagramSenderName,
  fetchSenderName,
} from './fetch-sender-profile.js';
import type { AdMetadataUpdate } from './resolve-ad-referral.js';

const logger = createLogger('HandleIncomingMessage');

type Conversation = typeof conversation.$inferSelect;

export interface CreateNewConversationInput {
  organizationId: string;
  externalUserId: string;
  platform: MessagingPlatform;
  isChatbotActive: boolean;
  metaAdsPageId: string | null;
  whatsappAccountId: string | null;
  page: {
    pageAccessToken: string | null;
    pageId: string;
    metaAdsIntegrationId: string;
  } | null;
  senderName?: string;
  adReferral?: AdMetadataUpdate | null;
  externalConversationId?: string;
}

/**
 * Create a new conversation, backfill message history, set sender name,
 * store ad referral metadata, and create a lead.
 */
export async function createNewConversation(
  db: DbConnection,
  input: CreateNewConversationInput
): Promise<Conversation> {
  const isStandaloneInstagram = input.page?.metaAdsIntegrationId === '';

  // 1. Insert conversation
  const [created] = await db
    .insert(conversation)
    .values({
      organizationId: input.organizationId,
      metaAdsPageId: input.metaAdsPageId,
      whatsappAccountId: input.whatsappAccountId,
      externalUserId: input.externalUserId,
      platform: input.platform,
      status: input.isChatbotActive ? 'bot_handling' : 'agent_handling',
      lastMessageAt: new Date(),
    })
    .returning();

  logger.info('Created new conversation', {
    conversationId: created.id,
    organizationId: created.organizationId,
    status: created.status,
    platform: created.platform,
  });

  trackOrgEvent(input.organizationId, 'conversation_created', {
    platform: input.platform,
    source: input.adReferral ? 'ad' : 'organic',
    conversationId: created.id,
  });

  // Durable birth record for the per-conversation audit trail (the start of
  // every conversation's timeline; status here shows whether the bot was even
  // eligible to respond).
  await logConversationEvent(db, {
    organizationId: input.organizationId,
    conversationId: created.id,
    event: 'conversation_created',
    action: 'create',
    metadata: {
      platform: input.platform,
      status: created.status,
      isChatbotActive: input.isChatbotActive,
      source: input.adReferral ? 'ad' : 'organic',
    },
  });

  // 2. Resolve sender name. Meta PSIDs/IGSIDs are always numeric — skip the
  // Graph API profile fetch for synthetic IDs (e.g. E2E `e2e-sender-*`).
  const isNumericUserId = /^\d+$/.test(input.externalUserId);
  let senderName = input.senderName;

  if (
    !senderName &&
    input.page?.pageAccessToken &&
    (input.platform === 'facebook_messenger' ||
      input.platform === 'instagram_dm') &&
    isNumericUserId
  ) {
    senderName = isStandaloneInstagram
      ? await fetchInstagramSenderName(
          input.page.pageAccessToken,
          input.externalUserId
        )
      : await fetchSenderName(input.page, input.externalUserId, input.platform);
  }

  // 3. Backfill message history from Meta (Messenger + non-standalone
  //    Instagram). WhatsApp Cloud API exposes no such endpoint — WA history
  //    arrives via the Coexistence `history` webhook instead.
  if (
    (input.platform === 'facebook_messenger' ||
      input.platform === 'instagram_dm') &&
    input.page?.pageAccessToken &&
    !isStandaloneInstagram &&
    isNumericUserId
  ) {
    try {
      const decryptedToken = decryptCredentials<{ accessToken: string }>(
        input.page.pageAccessToken
      );
      const messenger = new MetaMessagingService({
        pageAccessToken: decryptedToken.accessToken,
        pageId: input.page.pageId,
      });

      const history = await messenger.getConversationMessages(
        input.externalUserId,
        input.platform
      );

      if (history.length > 0) {
        const olderMessages = history
          .filter((m) => m.id !== input.externalConversationId)
          .reverse();

        for (const msg of olderMessages) {
          const isFromPage = msg.from.id === input.page.pageId;
          // Normalize stickers / media / shares from history so they render
          // with a label + metadata instead of as a blank bubble.
          const derived = deriveMessageContent(metaHistoryToRaw(msg));
          // Skip the Click-to-Messenger ad-click placeholder: a page-side,
          // text-less entry whose only "attachment" is an opaque, URL-less
          // blob (Meta's representation of the ad in history). We now surface
          // the ad itself via the conversation's ad-referral card, so this
          // bubble would just be redundant noise.
          const atts = derived.metadata?.attachments ?? [];
          const isAdClickPlaceholder =
            isFromPage &&
            !!input.adReferral &&
            derived.messageType !== 'text' &&
            atts.length > 0 &&
            atts.every((a) => a.type === 'unknown' && !a.url);
          if (isAdClickPlaceholder) continue;
          await db
            .insert(conversationMessage)
            .values({
              conversationId: created.id,
              role: isFromPage ? 'bot' : 'user',
              content: derived.content,
              messageType: derived.messageType,
              metadata: derived.metadata,
              externalMessageId: msg.id,
              origin: 'backfill',
              sentAt: new Date(msg.created_time),
            })
            .onConflictDoNothing();
        }
      }
    } catch (error) {
      logError('conversations.backfillHistory', error, {
        feature: 'conversations',
        extra: { conversationId: created.id, pageId: input.page.pageId },
      });
    }
  }

  // 4. Link this contact to its originating lead (reusing a Meta lead-form
  //    lead when the sender matches) or create a new one.
  const leadId = await linkOrCreateConversationLead(
    db,
    input.organizationId,
    input.externalUserId,
    senderName,
    input.platform,
    created.id
  );

  // 5. Build and save metadata (sender name + ad referral + linked lead)
  const adMetadata: Partial<AdMetadataUpdate> = input.adReferral ?? {};
  const convMetadata: ConversationMetadata = {
    ...(senderName ? { name: senderName } : {}),
    ...adMetadata,
    ...(leadId ? { leadId } : {}),
  };

  // Which branch this conversation is about, from the ad that produced it (or
  // the only branch, for a single-branch org). NULL when nothing said — never
  // the org default, which would fabricate a signal.
  //
  // Resolved AFTER the ad metadata is built, because that is where
  // `adInternalId` comes from.
  const locationId = await resolveConversationBranch(db, {
    organizationId: input.organizationId,
    adInternalId: convMetadata.adInternalId,
  });

  if (
    senderName ||
    Object.keys(adMetadata).length > 0 ||
    leadId ||
    locationId
  ) {
    await db
      .update(conversation)
      .set({
        ...(senderName ? { externalUserName: senderName } : {}),
        // Set the real FK column alongside the legacy metadata pointer.
        ...(leadId ? { leadId } : {}),
        ...(locationId ? { locationId } : {}),
        metadata: convMetadata,
      })
      .where(eq(conversation.id, created.id));
  }

  if (locationId) {
    logger.info('Resolved conversation branch', {
      conversationId: created.id,
      organizationId: created.organizationId,
      locationId,
      fromAd: Boolean(convMetadata.adInternalId),
    });
  }

  return created;
}
