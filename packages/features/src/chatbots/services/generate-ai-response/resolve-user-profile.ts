import { conversation, metaAdsPage } from '@borradh-workspace/database';
import type { ConversationMetadata } from '@borradh-workspace/database';
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { MetaMessagingService } from '@borradh-workspace/integrations/meta-messaging';
import { createLogger, logError } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import type { DbConnection } from '../../../shared/index.js';

const logger = createLogger('ChatbotCalendar');

export interface ResolveUserProfileInput {
  conversationId: string;
  externalUserId: string;
  platform: string;
  metaAdsPageId: string | null;
  existingSenderName: string | null | undefined;
  rawMetadata: ConversationMetadata | null;
}

export interface ResolvedUserProfile {
  displayName: string;
  updatedMetadata: ConversationMetadata | null;
}

/**
 * Resolve the user's display name for the AI context.
 *
 * Priority:
 * 1. metadata.name
 * 2. conv.externalUserName (passed as existingSenderName)
 * 3. Fetch from Meta API (last resort)
 * 4. Falls back to "there"
 *
 * If the name is fetched from Meta, it is persisted on the conversation.
 */
export async function resolveUserProfile(
  db: DbConnection,
  input: ResolveUserProfileInput
): Promise<ResolvedUserProfile> {
  const {
    conversationId,
    externalUserId,
    platform,
    metaAdsPageId,
    existingSenderName,
    rawMetadata,
  } = input;

  let resolvedName = rawMetadata?.name ?? existingSenderName;
  let updatedMetadata = rawMetadata;

  // Last-resort: fetch from Meta profile if still no name
  if (
    !resolvedName &&
    metaAdsPageId &&
    (platform === 'facebook_messenger' || platform === 'instagram_dm')
  ) {
    try {
      const page = await db.query.metaAdsPage.findFirst({
        where: eq(metaAdsPage.id, metaAdsPageId),
      });
      if (page?.pageAccessToken) {
        const decryptedToken = decryptCredentials<{ accessToken: string }>(
          page.pageAccessToken
        );
        const messenger = new MetaMessagingService({
          pageAccessToken: decryptedToken.accessToken,
          pageId: page.pageId,
        });
        const profile = await messenger.getUserProfile(
          externalUserId,
          platform as 'facebook_messenger' | 'instagram_dm'
        );
        const rawProfile = profile as unknown as Record<string, unknown>;
        resolvedName =
          (rawProfile.first_name as string) ??
          profile.firstName ??
          profile.name;
        if (resolvedName) {
          logger.info('Resolved sender name at AI response time', {
            conversationId,
            name: resolvedName,
          });
          updatedMetadata = { ...updatedMetadata, name: resolvedName };
          await db
            .update(conversation)
            .set({ externalUserName: resolvedName, metadata: updatedMetadata })
            .where(eq(conversation.id, conversationId));
        }
      }
    } catch (profileError) {
      logError('chatbots.fetchUserProfileFallback', profileError, {
        feature: 'chatbots',
        extra: { conversationId, platform },
      });
    }
  }

  const displayName = resolvedName ?? 'there';
  const finalMetadata = resolvedName
    ? { ...updatedMetadata, name: resolvedName }
    : updatedMetadata;

  return { displayName, updatedMetadata: finalMetadata };
}
