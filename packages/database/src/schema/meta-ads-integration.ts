import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { metaAdsPage } from './meta-ads-pages.js';
import { organization } from './organization.js';
import { user } from './user.js';

// Import labels from enums (pure TypeScript)
import {
  metaIntegrationStatusLabels,
  metaIntegrationStatusValues,
  tokenStatusLabels,
  tokenStatusValues,
} from '@borradh-workspace/labels';

// Re-export labels and values for consumers
export { metaIntegrationStatusLabels, metaIntegrationStatusValues };
export { tokenStatusLabels, tokenStatusValues };
export type {
  MetaIntegrationStatus,
  TokenStatus,
} from '@borradh-workspace/labels';

// Database enums
export const metaIntegrationStatusEnum = pgEnum(
  'meta_integration_status',
  metaIntegrationStatusValues
);

export const tokenStatusEnum = pgEnum('token_status', tokenStatusValues);

/**
 * Business info stored in JSONB during pending_selection state
 */
export interface MetaBusinessInfoStored {
  id: string;
  name: string;
  profilePictureUri?: string;
}

/**
 * Available ad account info stored in JSONB during pending_selection state
 */
export interface MetaAdAccountInfo {
  id: string;
  accountId: string;
  name: string;
  currency: string;
  accountStatus: number;
  businessName?: string;
  businessId?: string;
}

/**
 * Available page info stored in JSONB during pending_selection state
 */
export interface MetaPageInfoStored {
  id: string;
  name: string;
  accessToken: string;
  category?: string;
  pictureUrl?: string;
  businessId?: string;
  instagramBusinessAccount?: {
    id: string;
    name: string;
    username: string;
    profilePictureUrl?: string;
  };
}

/**
 * Meta Ads Integration - stores the organization's Meta Ads connection
 * Pages (Facebook/Instagram) are stored in the metaAdsPage table
 */
export const metaAdsIntegration = pgTable(
  'meta_ads_integration',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    connectedById: text('connected_by_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    // Configuration status
    configurationStatus: metaIntegrationStatusEnum('configuration_status')
      .notNull()
      .default('pending_selection'),

    // Selected Ad Account (null when pending_selection)
    // @deprecated — use metaAdsPage.defaultAdAccountId or metaCampaignConfig.adAccountId instead.
    // Kept as global fallback for backward compatibility.
    adAccountId: text('ad_account_id'),
    adAccountName: text('ad_account_name'),

    // Default page for posting (reference to metaAdsPage)
    defaultPageId: text('default_page_id'),

    // Available options stored during pending_selection (cleared after configuration)
    availableBusinesses: jsonb('available_businesses').$type<
      MetaBusinessInfoStored[]
    >(),
    availableAdAccounts: jsonb('available_ad_accounts').$type<
      MetaAdAccountInfo[]
    >(),
    availablePages: jsonb('available_pages').$type<MetaPageInfoStored[]>(),

    // Facebook user profile (fetched during OAuth via public_profile + email)
    facebookUserName: text('facebook_user_name'),
    facebookUserEmail: text('facebook_user_email'),
    facebookUserPictureUrl: text('facebook_user_picture_url'),

    // Status
    isActive: boolean('is_active').default(true).notNull(),

    // Token health status (set to 'needs_reconnect' when Meta returns auth errors)
    tokenStatus: tokenStatusEnum('token_status').notNull().default('valid'),

    // Encrypted credentials (user access token for API calls)
    encryptedCredentials: text('encrypted_credentials').notNull(),

    // Token expiration tracking
    tokenExpiresAt: timestamp('token_expires_at'),

    // How the integration was connected.
    //   'system_user' — the current path. A never-expiring token minted for a
    //     system user in OUR business portfolio, reading assets the client
    //     shared with us as a Partner. Nobody re-authorises it, ever.
    //   'flfb'        — Facebook Login for Business. Also a non-expiring
    //     system-user token, but obtained by walking the owner through a
    //     browser popup. Retired for new connections; existing rows keep
    //     working unchanged.
    //   'classic'     — redirect OAuth with a long-lived (~60 day) user token,
    //     refreshed on a schedule.
    //   NULL          — row predates this column; use isFlfbIntegration(),
    //     which falls back to the tokenExpiresAt IS NULL inference.
    connectionMethod: text('connection_method').$type<
      'classic' | 'flfb' | 'system_user'
    >(),

    // Sync tracking
    lastSyncAt: timestamp('last_sync_at'),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Each org can only have one Meta Ads integration
    unique('unique_org_meta_ads').on(table.organizationId),
    index('idx_meta_ads_integration_connected_by_id').on(table.connectedById),
  ]
);

export const metaAdsIntegrationRlsPolicy = orgRlsPolicy(metaAdsIntegration);

export const metaAdsIntegrationRelations = relations(
  metaAdsIntegration,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [metaAdsIntegration.organizationId],
      references: [organization.id],
    }),
    connectedBy: one(user, {
      fields: [metaAdsIntegration.connectedById],
      references: [user.id],
    }),
    pages: many(metaAdsPage),
    defaultPage: one(metaAdsPage, {
      fields: [metaAdsIntegration.defaultPageId],
      references: [metaAdsPage.id],
    }),
  })
);

export type MetaAdsIntegration = typeof metaAdsIntegration.$inferSelect;
export type NewMetaAdsIntegration = typeof metaAdsIntegration.$inferInsert;
