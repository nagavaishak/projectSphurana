import {
  creditBalances,
  creditTransactions,
  subscriptions,
} from '@borradh-workspace/database';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { DbConnection } from '../../../shared/index.js';
import { type SchemaDefinition, toParquetBuffer } from '../parquet/index.js';
import type { DomainExporter } from './types.js';

const schema: SchemaDefinition = {
  organization_id: { type: 'UTF8' },
  date: { type: 'UTF8' },
  subscription_status: { type: 'UTF8' },
  plan_id: { type: 'UTF8' },
  credit_balance: { type: 'INT64' },
  included_credits: { type: 'INT64' },
  credits_used_today: { type: 'INT64' },
  credits_sms: { type: 'INT64' },
  credits_voice: { type: 'INT64' },
  credits_whatsapp: { type: 'INT64' },
};

export const billingExporter: DomainExporter = {
  domain: 'billing',

  async export(db: DbConnection, date: Date): Promise<Buffer> {
    const dateStr = date.toISOString().split('T')[0] ?? '';
    const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
    const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);

    // Get current subscription + credit balance per org
    const subData = await db
      .select({
        organizationId: subscriptions.organizationId,
        status: subscriptions.status,
        planId: subscriptions.planId,
        balance: creditBalances.balance,
        includedCredits: creditBalances.includedCredits,
      })
      .from(subscriptions)
      .leftJoin(
        creditBalances,
        eq(subscriptions.organizationId, creditBalances.organizationId)
      );

    // Get credit usage per org per channel for this day
    const usageData = await db
      .select({
        organizationId: creditTransactions.organizationId,
        channel: creditTransactions.channel,
        totalUsed: sql<number>`coalesce(sum(abs(${creditTransactions.amount})), 0)`,
      })
      .from(creditTransactions)
      .where(
        and(
          eq(creditTransactions.type, 'usage'),
          gte(creditTransactions.createdAt, dayStart),
          lt(creditTransactions.createdAt, dayEnd)
        )
      )
      .groupBy(creditTransactions.organizationId, creditTransactions.channel);

    // Build usage map: orgId -> { channel -> amount }
    const usageMap = new Map<string, Map<string | null, number>>();
    for (const u of usageData) {
      if (!usageMap.has(u.organizationId)) {
        usageMap.set(u.organizationId, new Map());
      }
      usageMap.get(u.organizationId)?.set(u.channel, Number(u.totalUsed));
    }

    const rows = subData.map((s) => {
      const usage = usageMap.get(s.organizationId);
      const totalUsed = usage
        ? Array.from(usage.values()).reduce((a, b) => a + b, 0)
        : 0;
      return {
        organization_id: s.organizationId,
        date: dateStr,
        subscription_status: s.status,
        plan_id: s.planId,
        credit_balance: s.balance ?? 0,
        included_credits: s.includedCredits ?? 0,
        credits_used_today: totalUsed,
        credits_sms: usage?.get('sms') ?? 0,
        credits_voice: usage?.get('voice') ?? 0,
        credits_whatsapp: usage?.get('whatsapp') ?? 0,
      };
    });

    return toParquetBuffer(schema, rows);
  },
};
