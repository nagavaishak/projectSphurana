import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { organization } from './organization.js';

/**
 * Daily campaign insights synced from Meta Ads API.
 * Stores both original currency and USD-normalized values for cross-org comparison.
 */
export const metaCampaignDailyInsights = pgTable(
  'meta_campaign_daily_insights',
  {
    id: text('id').primaryKey(),

    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    metaCampaignId: text('meta_campaign_id').notNull(),
    metaAdId: text('meta_ad_id'), // nullable — campaign-level vs ad-level

    date: timestamp('date').notNull(), // the day this data covers

    // Original currency (what the user sees, source of truth)
    spend: integer('spend').notNull(), // in cents of original currency
    currency: text('currency').notNull(), // 'EUR', 'GBP', 'USD', etc.
    cpc: integer('cpc'), // in cents, original currency
    cpm: integer('cpm'), // in cents, original currency

    // USD-normalized (for cross-org comparison)
    spendUsd: integer('spend_usd').notNull(),
    cpcUsd: integer('cpc_usd'),
    cpmUsd: integer('cpm_usd'),
    exchangeRate: text('exchange_rate'), // rate used, e.g. '1.084'

    // Non-monetary metrics
    impressions: integer('impressions').notNull().default(0),
    reach: integer('reach').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    leads: integer('leads').notNull().default(0),
    conversions: integer('conversions').notNull().default(0),
    ctr: text('ctr'), // percentage string from Meta
    frequency: text('frequency'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    unq: unique().on(t.metaCampaignId, t.metaAdId, t.date),
    orgIdx: index('idx_meta_insights_org').on(t.organizationId),
    dateIdx: index('idx_meta_insights_date').on(t.date),
  })
);

export const metaCampaignDailyInsightsRlsPolicy = orgRlsPolicy(
  metaCampaignDailyInsights
);

export type MetaCampaignDailyInsight =
  typeof metaCampaignDailyInsights.$inferSelect;
export type NewMetaCampaignDailyInsight =
  typeof metaCampaignDailyInsights.$inferInsert;
