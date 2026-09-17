import type { ConversationMessagePair } from '@borradh-workspace/integrations/meta-messaging';

const URL_ONLY_REGEX = /^https?:\/\/\S+$/;
const MIN_REPLY_LENGTH = 20;
const MAX_MESSAGES = 1000;
const RECENCY_CUTOFF_DAYS = 14;

/**
 * Filter and deduplicate conversation message pairs for voice cloning.
 *
 * Filters:
 * - Drop messages from the past 2 weeks (too recent, style may shift)
 * - Drop replies < 20 characters
 * - Drop replies that are only URLs
 * - Drop exact duplicate businessReply content
 * - Keep only pairs with non-empty text
 * - Sort by timestamp descending (most recent first)
 * - Cap at 1000 pairs
 */
export function filterMessages(
  pairs: ConversationMessagePair[]
): ConversationMessagePair[] {
  const seenReplies = new Set<string>();
  const filtered: ConversationMessagePair[] = [];
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RECENCY_CUTOFF_DAYS);

  for (const pair of pairs) {
    // Skip pairs with empty text
    if (!pair.customerMessage?.trim() || !pair.businessReply?.trim()) {
      continue;
    }

    // Skip messages from the past 2 weeks
    if (pair.timestamp && new Date(pair.timestamp) > cutoffDate) {
      continue;
    }

    // Skip short replies
    if (pair.businessReply.length < MIN_REPLY_LENGTH) {
      continue;
    }

    // Skip URL-only replies
    if (URL_ONLY_REGEX.test(pair.businessReply.trim())) {
      continue;
    }

    // Skip exact duplicate replies
    if (seenReplies.has(pair.businessReply)) {
      continue;
    }

    seenReplies.add(pair.businessReply);
    filtered.push(pair);
  }

  // Sort by timestamp descending (most recent first)
  filtered.sort((a, b) => {
    const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return timeB - timeA;
  });

  // Cap at max
  return filtered.slice(0, MAX_MESSAGES);
}
