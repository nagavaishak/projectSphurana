import { metaCampaignDailyInsights } from '@borradh-workspace/database';
import { and, gte, lt } from 'drizzle-orm';
import type { DbConnection } from '../../../shared/index.js';
import { type SchemaDefinition, toParquetBuffer } from '../parquet/index.js';
import type { DomainExporter } from './types.js';

const schema: SchemaDefinition = {
  organization_id: { type: 'UTF8' },
  meta_campaign_id: { type: 'UTF8' },
  meta_ad_id: { type: 'UTF8', optional: true },
  date: { type: 'UTF8' },
  spend: { type: 'INT64' },
  spend_usd: { type: 'INT64' },
  currency: { type: 'UTF8' },
  impressions: { type: 'INT64' },
  reach: { type: 'INT64' },
  clicks: { type: 'INT64' },
  leads: { type: 'INT64' },
  conversions: { type: 'INT64' },
  cpc: { type: 'INT64', optional: true },
  cpm: { type: 'INT64', optional: true },
  ctr: { type: 'UTF8', optional: true },
  frequency: { type: 'UTF8', optional: true },
};

export const campaignsExporter: DomainExporter = {
  domain: 'campaigns',

  async export(db: DbConnection, date: Date): Promise<Buffer> {
    const dateStr = date.toISOString().split('T')[0] ?? '';
    const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
    const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);

    // Direct re-export of insights rows for this day
    const rows = await db
      .select({
        organizationId: metaCampaignDailyInsights.organizationId,
        metaCampaignId: metaCampaignDailyInsights.metaCampaignId,
        metaAdId: metaCampaignDailyInsights.metaAdId,
        date: metaCampaignDailyInsights.date,
        spend: metaCampaignDailyInsights.spend,
        spendUsd: metaCampaignDailyInsights.spendUsd,
        currency: metaCampaignDailyInsights.currency,
        impressions: metaCampaignDailyInsights.impressions,
        reach: metaCampaignDailyInsights.reach,
        clicks: metaCampaignDailyInsights.clicks,
        leads: metaCampaignDailyInsights.leads,
        conversions: metaCampaignDailyInsights.conversions,
        cpc: metaCampaignDailyInsights.cpc,
        cpm: metaCampaignDailyInsights.cpm,
        ctr: metaCampaignDailyInsights.ctr,
        frequency: metaCampaignDailyInsights.frequency,
      })
      .from(metaCampaignDailyInsights)
      .where(
        and(
          gte(metaCampaignDailyInsights.date, dayStart),
          lt(metaCampaignDailyInsights.date, dayEnd)
        )
      );

    const parquetRows = rows.map((r) => ({
      organization_id: r.organizationId,
      meta_campaign_id: r.metaCampaignId,
      meta_ad_id: r.metaAdId ?? null,
      date: dateStr,
      spend: r.spend,
      spend_usd: r.spendUsd,
      currency: r.currency,
      impressions: r.impressions,
      reach: r.reach,
      clicks: r.clicks,
      leads: r.leads,
      conversions: r.conversions,
      cpc: r.cpc ?? null,
      cpm: r.cpm ?? null,
      ctr: r.ctr ?? null,
      frequency: r.frequency ?? null,
    }));

    return toParquetBuffer(schema, parquetRows);
  },
};
