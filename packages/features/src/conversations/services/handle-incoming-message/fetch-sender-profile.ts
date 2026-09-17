import { fetchWithRetry } from '@borradh-workspace/http';
import { MetaApiError } from '@borradh-workspace/integrations';
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { MetaMessagingService } from '@borradh-workspace/integrations/meta-messaging';
import { INSTAGRAM_MESSAGING_API_BASE } from '@borradh-workspace/integrations/shared';
import { createLogger, logError } from '@borradh-workspace/observability';

const logger = createLogger('HandleIncomingMessage');

/**
 * Fetch the sender's name for standalone Instagram integrations.
 * Uses the Instagram Graph API (graph.instagram.com) since the Instagram Login
 * API token is incompatible with the Facebook Graph API (graph.facebook.com).
 */
export async function fetchInstagramSenderName(
  encryptedCredentials: string,
  senderId: string
): Promise<string | undefined> {
  let decryptedToken: { accessToken: string };
  try {
    decryptedToken = decryptCredentials<{ accessToken: string }>(
      encryptedCredentials
    );
  } catch {
    return undefined;
  }

  try {
    const response = await fetchWithRetry(
      `${INSTAGRAM_MESSAGING_API_BASE}/${senderId}?fields=name,username&access_token=${decryptedToken.accessToken}`
    );

    if (!response.ok) return undefined;

    const data = (await response.json()) as {
      name?: string;
      username?: string;
    };
    const name = data.name || data.username;
    if (name) {
      logger.info('Resolved sender name from Instagram Graph API', {
        senderId,
        name,
      });
    }
    return name;
  } catch {
    // Non-critical
    return undefined;
  }
}

/**
 * Fetch the sender's name from Meta APIs (User Profile + Conversations history).
 * Returns the name if found, undefined otherwise.
 */
export async function fetchSenderName(
  page: { pageAccessToken: string | null; pageId: string },
  senderId: string,
  platform: 'facebook_messenger' | 'instagram_dm'
): Promise<string | undefined> {
  if (!page.pageAccessToken) return undefined;

  let decryptedToken: { accessToken: string };
  try {
    decryptedToken = decryptCredentials<{ accessToken: string }>(
      page.pageAccessToken
    );
  } catch {
    return undefined;
  }

  const messenger = new MetaMessagingService({
    pageAccessToken: decryptedToken.accessToken,
    pageId: page.pageId,
  });

  // Tier 1: User Profile API
  try {
    const profile = await messenger.getUserProfile(senderId, platform);
    const rawProfile = profile as unknown as Record<string, unknown>;
    // Prefer `name` (full name, e.g. "John Smith") over `first_name` (just "John").
    // Meta Graph API returns snake_case keys; MetaUserProfile type uses camelCase.
    const firstName = (rawProfile.first_name as string) ?? profile.firstName;
    const lastName = (rawProfile.last_name as string) ?? profile.lastName;
    const fullName = profile.name ?? (rawProfile.name as string);
    const name =
      fullName ||
      (firstName && lastName ? `${firstName} ${lastName}` : undefined) ||
      firstName;
    if (name) {
      logger.info('Resolved sender name from profile API', {
        senderId,
        platform,
        name,
      });
      return name;
    }
  } catch (profileError) {
    // Expected Meta errors (missing profiles, restricted accounts) — don't log to Sentry
    const isExpected =
      profileError instanceof MetaApiError &&
      (profileError.category === 'not_found' ||
        profileError.category === 'permission_denied' ||
        profileError.category === 'user_blocked');
    if (!isExpected) {
      logError('conversations.fetchUserProfile', profileError, {
        feature: 'conversations',
        extra: { senderId, platform, pageId: page.pageId },
      });
    }
  }

  // Tier 2: Conversations API (from.name in message history)
  try {
    const history = await messenger.getConversationMessages(senderId, platform);
    if (history.length > 0) {
      const senderMessage = history.find(
        (m) => m.from.id !== page.pageId && m.from.name
      );
      if (senderMessage?.from.name) {
        logger.info('Resolved sender name from conversation history', {
          senderId,
          platform,
          name: senderMessage.from.name,
        });
        return senderMessage.from.name;
      }
    }
  } catch {
    // Non-critical
  }

  return undefined;
}
