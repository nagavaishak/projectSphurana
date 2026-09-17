import { conversation, conversationMessage } from '@borradh-workspace/database';
import { withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, desc, eq, exists, sql } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListConversationsInput,
  listConversationsSchema,
} from './list-conversations.schema.js';

type ConversationWithLastMessage = typeof conversation.$inferSelect & {
  lastMessageContent: string | null;
  lastMessageRole: string | null;
};

const listConversationsImpl = async (
  db: DbConnection,
  input: ListConversationsInput
): Promise<
  Result<{
    conversations: ConversationWithLastMessage[];
    total: number;
  }>
> => {
  const parsed = listConversationsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, status, limit, offset } = parsed.data;

  const conditions = [eq(conversation.organizationId, organizationId)];
  if (status) {
    conditions.push(eq(conversation.status, status));
  }

  // A conversation with no messages is not something anyone can act on: the
  // inbox renders it as a contact with a blank preview, and opening it shows an
  // empty thread.
  //
  // They exist because the conversation row is created BEFORE the opener is
  // delivered — deliberately, since it is the idempotency record that stops a
  // retried Meta webhook from double-messaging the lead (see
  // send-lead-first-touch). When delivery then fails the row stays behind and
  // no message ever joins it. An org with no SMS sender provisioned produces
  // one of these per lead-form lead.
  //
  // Hiding them at read time rather than not creating them keeps that
  // idempotency guarantee intact. Cheap:
  // `idx_conversation_message_conversation_id` makes this an index probe, and
  // EXISTS stops at the first row rather than counting.
  conditions.push(
    exists(
      db
        .select({ one: sql`1` })
        .from(conversationMessage)
        .where(eq(conversationMessage.conversationId, conversation.id))
    )
  );

  // Shared by BOTH the page query and the count below, so the total can never
  // disagree with what is actually listed.
  const where = and(...conditions);

  // Subquery for latest message per conversation
  const latestMessageSq = db
    .select({
      conversationId: conversationMessage.conversationId,
      content: conversationMessage.content,
      role: conversationMessage.role,
      rn: sql<number>`row_number() over (partition by ${conversationMessage.conversationId} order by ${conversationMessage.createdAt} desc)`.as(
        'rn'
      ),
    })
    .from(conversationMessage)
    .as('latest_msg');

  const [items, countResult] = await Promise.all([
    db
      .select({
        id: conversation.id,
        organizationId: conversation.organizationId,
        metaAdsPageId: conversation.metaAdsPageId,
        externalUserId: conversation.externalUserId,
        externalUserName: conversation.externalUserName,
        externalUserAvatar: conversation.externalUserAvatar,
        platform: conversation.platform,
        status: conversation.status,
        metadata: conversation.metadata,
        assignedToId: conversation.assignedToId,
        lastMessageAt: conversation.lastMessageAt,
        closedAt: conversation.closedAt,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        lastMessageContent: latestMessageSq.content,
        lastMessageRole: latestMessageSq.role,
      })
      .from(conversation)
      .leftJoin(
        latestMessageSq,
        and(
          eq(latestMessageSq.conversationId, conversation.id),
          eq(latestMessageSq.rn, 1)
        )
      )
      .where(where)
      .orderBy(desc(conversation.lastMessageAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversation)
      .where(where),
  ]);

  return ok({
    conversations: items as ConversationWithLastMessage[],
    total: countResult[0]?.count ?? 0,
  });
};

export const listConversations = (
  db: DbConnection,
  input: ListConversationsInput
) =>
  trackedResult(
    'conversations.listConversations',
    () => withOrgScope((tx) => listConversationsImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type ListConversationsResult = Awaited<
  ReturnType<typeof listConversations>
>;
