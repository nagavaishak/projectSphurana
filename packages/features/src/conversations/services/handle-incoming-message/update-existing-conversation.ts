import { conversation } from '@borradh-workspace/database';
import type { ConversationMetadata } from '@borradh-workspace/database';
import { createLogger } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { resolveConversationBranch } from '../../shared/resolve-conversation-branch.js';

import {
  cancelPendingFollowUp,
  cancelPendingMessageParts,
  cancelResponseTimeout,
} from '../../../chatbots/services/queue-chatbot-flow/queue-chatbot-flow.service.js';
import type { DbConnection } from '../../../shared/index.js';
import type { AdMetadataUpdate } from './resolve-ad-referral.js';

const logger = createLogger('HandleIncomingMessage');

type Conversation = typeof conversation.$inferSelect;

export interface UpdateExistingConversationInput {
  isChatbotActive: boolean;
  metaAdsPageId: string | null;
  whatsappAccountId: string | null;
  senderName?: string;
  adReferral?: AdMetadataUpdate | null;
}

/**
 * Update an existing conversation with bot transitions, backfills, and ad referral updates.
 * Returns the updated conversation object.
 */
export async function updateExistingConversation(
  db: DbConnection,
  conv: Conversation,
  input: UpdateExistingConversationInput
): Promise<Conversation> {
  let updated = conv;

  // 1. Never transition agent_handling → bot_handling on existing conversations.
  // Once a conversation is agent_handling, it stays that way. The bot only handles
  // conversations that were created as bot_handling from the start.

  // 2. Deactivate bot if chatbot was disabled for this page
  if (!input.isChatbotActive && updated.status === 'bot_handling') {
    await cancelResponseTimeout(updated.id);
    await cancelPendingMessageParts(updated.id);
    await cancelPendingFollowUp(updated.id);
    await db
      .update(conversation)
      .set({ status: 'agent_handling' })
      .where(eq(conversation.id, updated.id));
    updated = { ...updated, status: 'agent_handling' };
    logger.info(
      'Transitioned conversation to agent_handling (chatbot disabled for page)',
      { conversationId: updated.id }
    );
  }

  // 3. Backfill account link if missing, and RE-POINT a stale page pin.
  //
  // `conversation` is unique on (organizationId, externalUserId, platform) —
  // the page is NOT part of that identity, so it is only ever backfilled
  // when null. If the org disconnects and reconnects the same Meta page, the
  // new connection creates a new `meta_ads_page` row (unique on
  // (metaAdsIntegrationId, pageId)) and the conversation keeps pointing at
  // the OLD row. The old row's `pageAccessToken` + this conversation's PSID
  // were minted under the previous app connection, so sends against it fail
  // with Meta (#100) "No matching user found" (subcode 2018001) even though
  // the customer is perfectly reachable via the reconnected page (ENG-846).
  // The inbound webhook always carries the CURRENT page for this message, so
  // when it disagrees with the conversation's stored pin, that pin is stale
  // — move it forward.
  const needsPageRepoint =
    !!input.metaAdsPageId && input.metaAdsPageId !== updated.metaAdsPageId;
  const needsWhatsappBackfill =
    !!input.whatsappAccountId && !updated.whatsappAccountId;
  if (needsPageRepoint || needsWhatsappBackfill) {
    const previousMetaAdsPageId = updated.metaAdsPageId;
    await db
      .update(conversation)
      .set({
        ...(needsPageRepoint ? { metaAdsPageId: input.metaAdsPageId } : {}),
        ...(needsWhatsappBackfill
          ? { whatsappAccountId: input.whatsappAccountId }
          : {}),
      })
      .where(eq(conversation.id, updated.id));
    updated = {
      ...updated,
      metaAdsPageId: needsPageRepoint
        ? (input.metaAdsPageId as string)
        : updated.metaAdsPageId,
      whatsappAccountId: needsWhatsappBackfill
        ? (input.whatsappAccountId as string)
        : updated.whatsappAccountId,
    };
    if (needsPageRepoint) {
      logger.info('Re-pointed stale meta_ads_page pin on conversation', {
        conversationId: updated.id,
        oldPageId: previousMetaAdsPageId,
        newPageId: input.metaAdsPageId,
      });
    }
  }

  // 4. Backfill sender name if missing
  if (!updated.externalUserName && input.senderName) {
    const existingMetadata =
      (updated.metadata as ConversationMetadata | null) ?? {};
    const updatedMetadata = { ...existingMetadata, name: input.senderName };
    await db
      .update(conversation)
      .set({ externalUserName: input.senderName, metadata: updatedMetadata })
      .where(eq(conversation.id, updated.id));
    updated = {
      ...updated,
      externalUserName: input.senderName,
      metadata: updatedMetadata,
    };
    logger.info('Backfilled sender name on existing conversation', {
      conversationId: updated.id,
      senderName: input.senderName,
    });
  }

  // 5. Update ad referral if a returning user clicked a different ad
  if (input.adReferral?.adMetaId) {
    const existingMetadata =
      (updated.metadata as ConversationMetadata | null) ?? {};
    if (existingMetadata.adMetaId !== input.adReferral.adMetaId) {
      const updatedMetadata = { ...existingMetadata, ...input.adReferral };

      // A conversation row is unique on (org, external user, platform) — one
      // row per customer per platform, reused for life — so a returning
      // customer clicking a DIFFERENT ad is the same row with a new referral.
      // The branch has to move with it: a branch stamped at creation and never
      // revisited would quote March's Cork prices to a June enquiry that came
      // from a Dublin ad.
      //
      // Cleared, not left stale, when the new ad resolves nothing: the merge
      // above is a spread, so a referral whose ad we cannot find leaves the old
      // `adInternalId` in place — reading the branch off an ad the customer did
      // not click is worse than reading none.
      const locationId = await resolveConversationBranch(db, {
        organizationId: updated.organizationId,
        adInternalId: updatedMetadata.adInternalId,
      });

      await db
        .update(conversation)
        .set({ metadata: updatedMetadata, locationId })
        .where(eq(conversation.id, updated.id));
      updated = { ...updated, metadata: updatedMetadata, locationId };

      if (locationId !== updated.locationId) {
        logger.info('Conversation branch changed with a new ad referral', {
          conversationId: updated.id,
          organizationId: updated.organizationId,
          locationId,
        });
      }
    }
  }

  return updated;
}
