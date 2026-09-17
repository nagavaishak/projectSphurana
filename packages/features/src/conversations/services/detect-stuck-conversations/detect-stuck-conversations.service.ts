import {
  conversation,
  conversationMessage,
  organization,
} from '@borradh-workspace/database';
import type { MessagingPlatform } from '@borradh-workspace/database';
import { messagingPlatformLabels } from '@borradh-workspace/labels';
import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, desc, eq, lt, ne } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type DetectStuckConversationsInput,
  detectStuckConversationsSchema,
} from './detect-stuck-conversations.schema.js';

const logger = createLogger('DetectStuckConversations');

export interface StuckConversation {
  conversationId: string;
  organizationId: string;
  organizationName: string;
  externalUserName: string | null;
  platform: string;
  platformLabel: string;
  lastUserMessage: string;
  lastUserMessageAt: Date;
}

const detectStuckConversationsImpl = async (
  db: DbConnection,
  input: DetectStuckConversationsInput
): Promise<Result<{ stuck: StuckConversation[] }>> => {
  const parsed = detectStuckConversationsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { staleMinutes } = parsed.data;
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);

  try {
    // Find bot_handling conversations where last_message_at is older than cutoff
    const candidates = await db.query.conversation.findMany({
      where: and(
        eq(conversation.status, 'bot_handling'),
        lt(conversation.lastMessageAt, cutoff)
      ),
    });

    const stuck: StuckConversation[] = [];

    for (const conv of candidates) {
      // Get the latest message
      const latestMsg = await db.query.conversationMessage.findFirst({
        where: eq(conversationMessage.conversationId, conv.id),
        orderBy: [desc(conversationMessage.sentAt)],
      });

      if (!latestMsg || latestMsg.role !== 'user') continue;

      // Check there's no live bot reply after this user message
      const botReplyAfter = await db.query.conversationMessage.findFirst({
        where: and(
          eq(conversationMessage.conversationId, conv.id),
          eq(conversationMessage.role, 'bot'),
          ne(conversationMessage.origin, 'backfill')
        ),
        orderBy: [desc(conversationMessage.sentAt)],
      });

      if (
        botReplyAfter?.sentAt &&
        latestMsg.sentAt &&
        botReplyAfter.sentAt > latestMsg.sentAt
      ) {
        continue; // Bot did reply, just the lastMessageAt is stale
      }

      const org = await db.query.organization.findFirst({
        where: and(
          eq(organization.id, conv.organizationId),
          notDeleted(organization)
        ),
        columns: { name: true },
      });

      stuck.push({
        conversationId: conv.id,
        organizationId: conv.organizationId,
        organizationName: org?.name ?? 'Unknown',
        externalUserName: conv.externalUserName,
        platform: conv.platform,
        platformLabel:
          messagingPlatformLabels[conv.platform as MessagingPlatform] ??
          conv.platform,
        lastUserMessage: latestMsg.content ?? '',
        lastUserMessageAt: latestMsg.sentAt ?? latestMsg.createdAt,
      });
    }

    if (stuck.length > 0) {
      logger.warn(`Found ${stuck.length} stuck conversations`, {
        conversationIds: stuck.map((s) => s.conversationId),
      });
    }

    return ok({ stuck });
  } catch (error) {
    logError('conversations.detectStuckConversations', error, {
      feature: 'conversations',
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to detect stuck conversations'
      )
    );
  }
};

export const detectStuckConversations = (
  db: DbConnection,
  input: DetectStuckConversationsInput
) =>
  trackedResult(
    'conversations.detectStuckConversations',
    () => detectStuckConversationsImpl(db, input),
    { properties: { staleMinutes: input.staleMinutes } }
  );
