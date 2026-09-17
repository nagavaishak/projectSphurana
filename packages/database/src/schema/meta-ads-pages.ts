import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  boolean,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { childOrgRlsPolicy } from '../rls-policy.js';
import { metaAdsIntegration } from './meta-ads-integration.js';

// Import labels from enums (pure TypeScript)
import {
  metaPagePlatformLabels,
  metaPagePlatformValues,
} from '@borradh-workspace/labels';

// Re-export labels and values for consumers
export { metaPagePlatformLabels, metaPagePlatformValues };
export type { MetaPagePlatform } from '@borradh-workspace/labels';

// Database enum
export const metaPagePlatformEnum = pgEnum(
  'meta_page_platform',
  metaPagePlatformValues
);

/**
 * Meta Ads Page - stores individual Facebook/Instagram pages connected to an organization
 * Each organization's Meta integration can have multiple pages
 */
export const metaAdsPage = pgTable(
  'meta_ads_page',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    metaAdsIntegrationId: text('meta_ads_integration_id')
      .notNull()
      .references(() => metaAdsIntegration.id, { onDelete: 'cascade' }),

    // Page identifiers
    pageId: text('page_id').notNull(),
    pageName: text('page_name'),
    pageAccessToken: text('page_access_token'), // Encrypted page token

    // Username (Instagram username or Facebook page vanity)
    pageUsername: text('page_username'),
    // Profile/page picture URL
    pagePictureUrl: text('page_picture_url'),

    // Platform type
    platform: metaPagePlatformEnum('platform').notNull(),

    // Linked Instagram Business Account (discovered from Pages API)
    linkedInstagramAccountId: text('linked_instagram_account_id'),
    linkedInstagramUsername: text('linked_instagram_username'),
    linkedInstagramName: text('linked_instagram_name'),

    // Optional Pixel (for Facebook pages)
    pixelId: text('pixel_id'),
    pixelName: text('pixel_name'),

    // Default Lead Form (selected from Meta or created)
    defaultLeadFormId: text('default_lead_form_id'),
    defaultLeadFormName: text('default_lead_form_name'),

    // Default ad account for this page (auto-filled from integration, overridable per-page)
    defaultAdAccountId: text('default_ad_account_id'),
    defaultAdAccountName: text('default_ad_account_name'),
    defaultAdAccountCurrency: text('default_ad_account_currency'), // ISO 4217

    // Status
    isActive: boolean('is_active').default(true).notNull(),

    // Whether the AI chatbot is enabled for this page
    isChatbotActive: boolean('is_chatbot_active').default(false).notNull(),

    // Sync tracking
    lastSyncAt: timestamp('last_sync_at'),

    // Cursor for the leadgen reconciliation poll (ENG-786): the created_time
    // of the newest lead we have pulled for this page. Meta can withhold
    // `leadgen` webhook delivery for a Page while still serving lead reads, so
    // the poll is the floor under the webhook — this column keeps it cheap by
    // asking Meta only for leads newer than what we already have.
    lastLeadPollAt: timestamp('last_lead_poll_at'),

    // `{ [metaFormId]: leadsCount }` as Meta last reported it. The poll asks
    // for `leads_count` on the cheap `leadgen_forms` edge (one call per page)
    // and only reads a form's leads when that count has MOVED. Without this a
    // page with 20 forms costs 20 Graph calls every tick to learn nothing.
    leadFormCounts: jsonb('lead_form_counts').$type<Record<string, number>>(),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Each page can only be connected once per integration
    unique('unique_integration_page').on(
      table.metaAdsIntegrationId,
      table.pageId
    ),
  ]
);

export const metaAdsPageRelations = relations(metaAdsPage, ({ one }) => ({
  integration: one(metaAdsIntegration, {
    fields: [metaAdsPage.metaAdsIntegrationId],
    references: [metaAdsIntegration.id],
  }),
}));

// Bucket B1: meta_ads_page has no organization_id; org scope derives from the
// parent meta_ads_integration row via meta_ads_integration_id FK.
export const metaAdsPageRlsPolicy = childOrgRlsPolicy(metaAdsPage, {
  parent: 'meta_ads_integration',
  fk: 'meta_ads_integration_id',
});

export type MetaAdsPage = typeof metaAdsPage.$inferSelect;
export type NewMetaAdsPage = typeof metaAdsPage.$inferInsert;
