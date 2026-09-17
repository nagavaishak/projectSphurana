import {
  conversation,
  conversationMessage,
  instagramIntegration,
  metaAdsIntegration,
  metaAdsPage,
} from '@borradh-workspace/database';
import { withOrgScope } from '@borradh-workspace/database';
import { MetaApiError, isMetaAuthError } from '@borradh-workspace/integrations';
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { MetaMessagingService } from '@borradh-workspace/integrations/meta-messaging';
import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, eq, inArray, sql } from 'drizzle-orm';

import {
  handleMetaAuthError,
  metaTypeForPlatform,
} from '../../../integrations/services/mark-needs-reconnect/mark-needs-reconnect.service.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  deriveMessageContent,
  metaHistoryToRaw,
} from '../handle-incoming-message/derive-message-content.js';
import {
  type SyncConversationMessagesInput,
  syncConversationMessagesSchema,
} from './sync-conversation-messages.schema.js';

const logger = createLogger('SyncConversationMessages');

/**
 * Determine the role for a page-side message pulled from Meta's history.
 * If we already have a local message with matching content within a 5-second
 * window, reuse its role (so agent-sent messages stay labeled as 'agent'
 * rather than being misclassified as 'bot'). Otherwise default to 'agent',
 * since an unknown page-side message is more likely a human reply than a bot
 * broadcast we didn't record locally.
 */
async function determineSyncRole(
  db: DbConnection,
  conversationId: string,
  content: string,
  sentAt: Date
): Promise<'bot' | 'agent' | 'user'> {
  const fiveSeconds = 5000;
  const windowStart = new Date(sentAt.getTime() - fiveSeconds);
  const windowEnd = new Date(sentAt.getTime() + fiveSeconds);

  const localMatch = await db.query.conversationMessage.findFirst({
    where: and(
      eq(conversationMessage.conversationId, conversationId),
      eq(conversationMessage.content, content),
      sql`${conversationMessage.sentAt} >= ${windowStart.toISOString()}`,
      sql`${conversationMessage.sentAt} <= ${windowEnd.toISOString()}`
    ),
    columns: { role: true },
  });

  if (localMatch) return localMatch.role as 'bot' | 'agent' | 'user';
  return 'agent';
}

type Conversation = typeof conversation.$inferSelect;

/**
 * Build a MetaMessagingService for a conversation based on its token source.
 * Returns null if no valid token is available.
 */
async function buildMessenger(
  db: DbConnection,
  conv: Conversation
): Promise<{ messenger: MetaMessagingService; pageId: string } | null> {
  // Meta Ads page path (Messenger or Instagram via Meta Ads)
  if (conv.metaAdsPageId) {
    const page = await db.query.metaAdsPage.findFirst({
      where: eq(metaAdsPage.id, conv.metaAdsPageId),
    });
    if (!page?.pageAccessToken) return null;

    // Short-circuit known-dead tokens: if the parent integration is already
    // flagged needs_reconnect, don't call Meta with a token we know is dead.
    const integration = await db.query.metaAdsIntegration.findFirst({
      where: eq(metaAdsIntegration.id, page.metaAdsIntegrationId),
      columns: { tokenStatus: true },
    });
    if (integration?.tokenStatus === 'needs_reconnect') return null;

    try {
      const decrypted = decryptCredentials<{ accessToken: string }>(
        page.pageAccessToken
      );
      return {
        messenger: new MetaMessagingService({
          pageAccessToken: decrypted.accessToken,
          pageId: page.pageId,
        }),
        pageId: page.pageId,
      };
    } catch {
      return null;
    }
  }

  // Standalone Instagram path
  if (conv.platform === 'instagram_dm') {
    const igInteg = await db.query.instagramIntegration.findFirst({
      where: and(
        eq(instagramIntegration.organizationId, conv.organizationId),
        eq(instagramIntegration.isActive, true)
      ),
    });
    if (!igInteg?.encryptedCredentials) return null;

    // Short-circuit known-dead Instagram tokens.
    if (igInteg.tokenStatus === 'needs_reconnect') return null;

    try {
      const decrypted = decryptCredentials<{ accessToken: string }>(
        igInteg.encryptedCredentials
      );
      const pageId = igInteg.instagramUserId || conv.externalUserId;
      return {
        messenger: new MetaMessagingService({
          pageAccessToken: decrypted.accessToken,
          pageId,
          graphApiBase: 'https://graph.instagram.com',
        }),
        pageId,
      };
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Sync messages from Meta for all conversations in the organization.
 * Fetches message history from Meta APIs and inserts any missing messages,
 * deduplicating by externalMessageId.
 */
const syncConversationMessagesImpl = async (
  db: DbConnection,
  input: SyncConversationMessagesInput
): Promise<Result<{ synced: number; errors: number }>> => {
  const parsed = syncConversationMessagesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    // Find all non-closed conversations for this org on Meta platforms
    const conversations = await db.query.conversation.findMany({
      where: and(
        eq(conversation.organizationId, parsed.data.organizationId),
        inArray(conversation.platform, ['facebook_messenger', 'instagram_dm'])
      ),
    });

    if (conversations.length === 0) {
      return ok({ synced: 0, errors: 0 });
    }

    let totalSynced = 0;
    let totalErrors = 0;

    // Once a page's token comes back as an auth error (190/460, …) it's dead
    // for EVERY conversation on that page. Track those pageIds so we don't
    // re-hammer the dead token for each remaining conversation this run.
    const deadPageIds = new Set<string>();

    for (const conv of conversations) {
      // Track the page this conversation uses so the catch block can mark the
      // whole page dead on an auth error.
      let currentPageId: string | null = null;
      try {
        // Skip conversations with non-numeric external user IDs (e.g. E2E test
        // fixtures). Meta's Conversations API requires a numeric PSID and
        // returns an opaque error for anything else, so there's no point
        // making the call.
        if (!/^\d+$/.test(conv.externalUserId)) {
          continue;
        }

        const result = await buildMessenger(db, conv);
        if (!result) continue;

        const { messenger, pageId } = result;
        currentPageId = pageId;

        // The token for this page already failed auth this run — skip.
        if (deadPageIds.has(pageId)) continue;

        // Use the throwing variant so a MetaApiError (e.g. a 190 dead-token
        // auth error) propagates into the catch below — `handleMetaAuthError`
        // then marks the integration needs_reconnect. The swallowing variant
        // returns [] and would make that handling dead code.
        const history = await messenger.getConversationMessagesOrThrow(
          conv.externalUserId,
          conv.platform === 'instagram_dm'
            ? 'instagram_dm'
            : 'facebook_messenger'
        );

        if (history.length === 0) continue;

        // Get existing external message IDs for this conversation to avoid duplicates
        const existingMessages = await db.query.conversationMessage.findMany({
          where: eq(conversationMessage.conversationId, conv.id),
          columns: { externalMessageId: true },
        });

        const existingIds = new Set(
          existingMessages.map((m) => m.externalMessageId).filter(Boolean)
        );

        const newMessages = history.filter(
          (m) => m.id && !existingIds.has(m.id)
        );

        if (newMessages.length === 0) continue;

        // Insert in chronological order (API returns newest first)
        for (const msg of newMessages.reverse()) {
          const isFromPage = msg.from.id === pageId;
          const role = isFromPage
            ? await determineSyncRole(
                db,
                conv.id,
                msg.message || '',
                new Date(msg.created_time)
              )
            : 'user';
          // Normalize stickers/media/shares so they don't sync in blank.
          const derived = deriveMessageContent(metaHistoryToRaw(msg));
          await db
            .insert(conversationMessage)
            .values({
              conversationId: conv.id,
              role,
              content: derived.content,
              messageType: derived.messageType,
              externalMessageId: msg.id,
              origin: 'sync',
              sentAt: new Date(msg.created_time),
              metadata: isFromPage
                ? { ...(derived.metadata ?? {}), synced: true }
                : derived.metadata,
            })
            .onConflictDoNothing();
        }

        totalSynced += newMessages.length;

        logger.info('Synced conversation messages', {
          conversationId: conv.id,
          newMessages: newMessages.length,
        });
      } catch (error) {
        // Conversation archived or deleted on Meta's side — close it locally
        // and continue rather than treating it as an error.
        if (error instanceof MetaApiError && error.subcode === 2018365) {
          await db
            .update(conversation)
            .set({ status: 'closed', closedAt: new Date() })
            .where(eq(conversation.id, conv.id));
          logger.info('marked conversation as closed (archived on meta)', {
            conversationId: conv.id,
          });
          continue;
        }

        totalErrors++;
        // Expected, user/recipient-side Meta conditions (dead token, blocked
        // recipient, …) are warn-level: they're surfaced to the org via other
        // channels (needs_reconnect) and must not trip infra error alerts.
        if (error instanceof MetaApiError && error.isExpected) {
          logger.warn('Expected Meta error syncing conversation', {
            conversationId: conv.id,
            organizationId: parsed.data.organizationId,
            platform: conv.platform,
            metaCategory: error.category,
            metaCode: error.code,
            metaSubcode: error.subcode,
            message: error.message,
          });
        } else {
          logError('conversations.syncMessages.conversation', error, {
            feature: 'conversations',
            extra: {
              conversationId: conv.id,
              organizationId: parsed.data.organizationId,
              platform: conv.platform,
            },
          });
        }
        await handleMetaAuthError(db, error, {
          type: metaTypeForPlatform(conv.platform),
          organizationId: parsed.data.organizationId,
        });

        // An auth error means this page's token is dead for every remaining
        // conversation on it. Mark the page so we skip the rest this run
        // instead of re-hammering the dead token once per conversation.
        if (currentPageId && isMetaAuthError(error)) {
          deadPageIds.add(currentPageId);
        }
      }
    }

    logger.info('Sync complete', {
      organizationId: parsed.data.organizationId,
      conversations: conversations.length,
      synced: totalSynced,
      errors: totalErrors,
    });

    return ok({ synced: totalSynced, errors: totalErrors });
  } catch (error) {
    logError('conversations.syncMessages', error, {
      feature: 'conversations',
      extra: { organizationId: parsed.data.organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to sync conversation messages'
      )
    );
  }
};

export const syncConversationMessages = (
  db: DbConnection,
  input: SyncConversationMessagesInput
) =>
  trackedResult(
    'conversations.syncMessages',
    () => withOrgScope((tx) => syncConversationMessagesImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type SyncConversationMessagesResult = Awaited<
  ReturnType<typeof syncConversationMessages>
>;
