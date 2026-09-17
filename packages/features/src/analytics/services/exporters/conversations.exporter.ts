import { conversation, conversationMessage } from '@borradh-workspace/database';
import { and, count, eq, gte, lt, sql } from 'drizzle-orm';
import type { DbConnection } from '../../../shared/index.js';
import { type SchemaDefinition, toParquetBuffer } from '../parquet/index.js';
import type { DomainExporter } from './types.js';

const schema: SchemaDefinition = {
  organization_id: { type: 'UTF8' },
  date: { type: 'UTF8' },
  total_conversations: { type: 'INT64' },
  new_conversations: { type: 'INT64' },
  platform_facebook_messenger: { type: 'INT64' },
  platform_instagram_dm: { type: 'INT64' },
  platform_whatsapp: { type: 'INT64' },
  status_bot_handling: { type: 'INT64' },
  status_agent_handling: { type: 'INT64' },
  status_closed: { type: 'INT64' },
  bot_resolved: { type: 'INT64' },
  escalated: { type: 'INT64' },
  total_messages: { type: 'INT64' },
  user_messages: { type: 'INT64' },
  bot_messages: { type: 'INT64' },
  agent_messages: { type: 'INT64' },
};

export const conversationsExporter: DomainExporter = {
  domain: 'conversations',

  async export(db: DbConnection, date: Date): Promise<Buffer> {
    const dateStr = date.toISOString().split('T')[0] ?? '';
    const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
    const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);

    // Aggregate conversation stats per org
    const convStats = await db
      .select({
        organizationId: conversation.organizationId,
        total: count(),
        newConversations: sql<number>`count(*) filter (where ${conversation.createdAt} >= ${dayStart.toISOString()} and ${conversation.createdAt} <= ${dayEnd.toISOString()})`,
        platformFb: sql<number>`count(*) filter (where ${conversation.platform} = 'facebook_messenger')`,
        platformIg: sql<number>`count(*) filter (where ${conversation.platform} = 'instagram_dm')`,
        platformWa: sql<number>`count(*) filter (where ${conversation.platform} = 'whatsapp')`,
        statusBot: sql<number>`count(*) filter (where ${conversation.status} = 'bot_handling')`,
        statusAgent: sql<number>`count(*) filter (where ${conversation.status} = 'agent_handling')`,
        statusClosed: sql<number>`count(*) filter (where ${conversation.status} = 'closed')`,
        botResolved: sql<number>`count(*) filter (where ${conversation.status} = 'closed' and ${conversation.closedAt} is not null and ${conversation.status} != 'agent_handling')`,
        escalated: sql<number>`count(*) filter (where ${conversation.status} in ('agent_handling', 'closed') and exists (select 1 from ${conversation} c2 where c2.id = ${conversation.id}))`,
      })
      .from(conversation)
      .where(
        // Include conversations that existed on this day
        lt(conversation.createdAt, dayEnd)
      )
      .groupBy(conversation.organizationId);

    // Aggregate message stats per org for this day
    const msgStats = await db
      .select({
        organizationId: conversation.organizationId,
        totalMessages: count(),
        userMessages: sql<number>`count(*) filter (where ${conversationMessage.role} = 'user')`,
        botMessages: sql<number>`count(*) filter (where ${conversationMessage.role} = 'bot')`,
        agentMessages: sql<number>`count(*) filter (where ${conversationMessage.role} = 'agent')`,
      })
      .from(conversationMessage)
      .innerJoin(
        conversation,
        eq(conversationMessage.conversationId, conversation.id)
      )
      .where(
        and(
          gte(conversationMessage.createdAt, dayStart),
          lt(conversationMessage.createdAt, dayEnd)
        )
      )
      .groupBy(conversation.organizationId);

    const msgMap = new Map(msgStats.map((m) => [m.organizationId, m]));

    const rows = convStats.map((c) => {
      const msgs = msgMap.get(c.organizationId);
      return {
        organization_id: c.organizationId,
        date: dateStr,
        total_conversations: Number(c.total),
        new_conversations: Number(c.newConversations),
        platform_facebook_messenger: Number(c.platformFb),
        platform_instagram_dm: Number(c.platformIg),
        platform_whatsapp: Number(c.platformWa),
        status_bot_handling: Number(c.statusBot),
        status_agent_handling: Number(c.statusAgent),
        status_closed: Number(c.statusClosed),
        bot_resolved: Number(c.botResolved),
        escalated: Number(c.escalated),
        total_messages: Number(msgs?.totalMessages ?? 0),
        user_messages: Number(msgs?.userMessages ?? 0),
        bot_messages: Number(msgs?.botMessages ?? 0),
        agent_messages: Number(msgs?.agentMessages ?? 0),
      };
    });

    return toParquetBuffer(schema, rows);
  },
};
