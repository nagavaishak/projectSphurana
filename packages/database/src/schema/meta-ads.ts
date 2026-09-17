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
import { joinRlsPolicy, orgRlsPolicy } from '../rls-policy.js';
import { experiment } from './experiment.js';
import { leadForm } from './lead-form.js';
import { metaAdsPage } from './meta-ads-pages.js';
import { organizationLocation } from './organization-location.js';
import { organizationService } from './organization-service.js';
import { organization } from './organization.js';
import { sequence } from './sequences.js';
import { socialPost } from './social-posts.js';
import { video } from './video.js';

// ==================== ENUM IMPORTS (from canonical enums/) ====================

import {
  adPlacementLabels,
  adPlacementValues,
  conversionDestinationAllValues,
  conversionDestinationLabels,
  conversionDestinationValues,
  followUpTypeLabels,
  followUpTypeValues,
  messagingDestinationLabels,
  messagingDestinationValues,
  metaAdStatusLabels,
  metaAdStatusValues,
  metaCallToActionLabels,
  metaCallToActionValues,
  metaCampaignObjectiveLabels,
  metaCampaignObjectiveValues,
  metaCampaignStatusLabels,
  metaCampaignStatusValues,
} from '@borradh-workspace/labels';

// Re-export labels and values for consumers
export {
  metaCampaignStatusLabels,
  metaCampaignStatusValues,
  metaCampaignObjectiveLabels,
  metaCampaignObjectiveValues,
  metaAdStatusLabels,
  metaAdStatusValues,
  metaCallToActionLabels,
  metaCallToActionValues,
  followUpTypeLabels,
  followUpTypeValues,
  adPlacementLabels,
  adPlacementValues,
  conversionDestinationLabels,
  conversionDestinationValues,
  messagingDestinationLabels,
  messagingDestinationValues,
};
export type {
  MetaCampaignStatus,
  MetaCampaignObjective,
  MetaAdStatus,
  MetaCallToAction,
  FollowUpType,
  AdPlacement,
  ConversionDestination,
  MessagingDestination,
} from '@borradh-workspace/labels';

// ==================== ENUMS ====================

export const metaCampaignStatusEnum = pgEnum(
  'meta_campaign_status',
  metaCampaignStatusValues
);

export const metaCampaignObjectiveEnum = pgEnum(
  'meta_campaign_objective',
  metaCampaignObjectiveValues
);

export const metaAdStatusEnum = pgEnum('meta_ad_status', metaAdStatusValues);

export const metaCallToActionEnum = pgEnum(
  'meta_call_to_action',
  metaCallToActionValues
);

export const followUpTypeEnum = pgEnum('follow_up_type', followUpTypeValues);

export const adPlacementEnum = pgEnum('ad_placement', adPlacementValues);

export const conversionDestinationEnum = pgEnum(
  'conversion_destination',
  conversionDestinationAllValues
);

// ==================== TYPE INTERFACES ====================

/**
 * Targeting configuration for ads
 */
export interface MetaTargeting {
  /** Location name (city, region, or country) */
  location?: string;
  /** Latitude for location */
  latitude?: number;
  /** Longitude for location */
  longitude?: number;
  /** Distance radius in kilometers */
  distanceKm?: number;
  /** Minimum age (18-65) */
  ageMin?: number;
  /** Maximum age (18-65) */
  ageMax?: number;
  /** Gender targeting: 1 = male, 2 = female, null = all */
  genders?: number[];
  /** Country codes for broader targeting */
  countries?: string[];
}

// ==================== AD TABLE ====================

/**
 * Meta Ad - individual ad referencing a Meta campaign directly via Meta campaign ID.
 * Campaigns are fetched live from Meta API, not stored locally.
 */
export const metaAd = pgTable(
  'meta_ad',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // Meta campaign/ad set references (Meta's IDs, not local)
    metaCampaignId: text('meta_campaign_id'),
    metaAdSetId: text('meta_ad_set_id'),

    // Organization scope
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    // References either video.id or asset.id (validated in service layer)
    // Nullable for imported ads that don't have a local video
    videoId: text('video_id'),

    // Graphic creative reference (image ad). An ad's creative is media-agnostic:
    // exactly one of `videoId` / `graphicId` is set (enforced in the service
    // layer). When set, finalize-ad uploads the graphic's rendered PNG to Meta
    // as an image creative. References `graphic.id`; no FK (kept symmetric with
    // videoId, which can point at video OR asset).
    graphicId: text('graphic_id'),

    // Social post reference (for "use existing post" / boost flow)
    socialPostId: text('social_post_id').references(() => socialPost.id, {
      onDelete: 'set null',
    }),
    useExistingPost: boolean('use_existing_post').notNull().default(false),

    // Ad creative details
    name: text('name').notNull(),
    headline: text('headline'),
    primaryText: text('primary_text'),
    description: text('description'),
    callToAction: metaCallToActionEnum('call_to_action').default('LEARN_MORE'),
    destinationUrl: text('destination_url'),

    // Whether this ad was imported from Meta (not created in Borradh)
    isImported: boolean('is_imported').notNull().default(false),

    // Status
    status: metaAdStatusEnum('status').notNull().default('draft'),

    // Optional targeting override
    targetingOverride: jsonb('targeting_override').$type<MetaTargeting>(),

    // Follow-up configuration
    followUpType: followUpTypeEnum('follow_up_type')
      .notNull()
      .default('lead_form'),

    // Lead form and sequence (for OUTCOME_LEADS campaigns)
    leadFormId: text('lead_form_id').references(() => leadForm.id, {
      onDelete: 'set null',
    }),
    sequenceId: text('sequence_id').references(() => sequence.id, {
      onDelete: 'set null',
    }),
    // Ad placement & conversion destination
    adPlacement: adPlacementEnum('ad_placement').notNull().default('facebook'),

    /**
     * @deprecated Legacy single-destination field. Use `destinations` (below)
     * for new ads — it supports multi-select messaging destinations and maps
     * to Meta's combo `destination_type` values.
     */
    conversionDestination: conversionDestinationEnum('conversion_destination'),

    /**
     * Messaging destinations for this ad. Non-empty subset of
     * ('whatsapp' | 'messenger' | 'instagram_dm'). Per-ad rather than
     * per-campaign: ads with the same destinations reuse the same Meta
     * ad set within a campaign, and a new ad set is created on launch
     * for each distinct destinations shape.
     *
     * Nullable during the migration window; non-null for chatbot ads
     * created after ENG-178 lands.
     */
    destinations: text('destinations').array(),
    metaAdsPageId: text('meta_ads_page_id').references(() => metaAdsPage.id, {
      onDelete: 'set null',
    }),

    // Ad account snapshot (immutable — set at launch/publish)
    adAccountId: text('ad_account_id'),

    // Meta sync fields
    metaAdId: text('meta_ad_id'),
    metaCreativeId: text('meta_creative_id'),
    metaVideoId: text('meta_video_id'),
    metaImageHash: text('meta_image_hash'),
    metaStatus: text('meta_status'),
    lastSyncAt: timestamp('last_sync_at'),
    syncError: text('sync_error'),

    // Thumbnail URL from Meta creative (for imported ads without local video)
    metaThumbnailUrl: text('meta_thumbnail_url'),

    // Permalink to the actual ad post on Facebook (from effective_object_story_id)
    metaPermalink: text('meta_permalink'),

    // Timestamps
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_meta_ad_org_id').on(table.organizationId),
    index('idx_meta_ad_lead_form_id').on(table.leadFormId),
    index('idx_meta_ad_sequence_id').on(table.sequenceId),
    index('idx_meta_ad_meta_ads_page_id').on(table.metaAdsPageId),
    index('idx_meta_ad_meta_ad_id').on(table.metaAdId),
    index('idx_meta_ad_social_post_id').on(table.socialPostId),
  ]
);

export const metaAdRlsPolicy = orgRlsPolicy(metaAd);

// ==================== AD-SERVICE JUNCTION TABLE ====================

/**
 * Many-to-many junction between ads and organization services.
 * Links an ad to the service(s) it promotes.
 */
export const metaAdService = pgTable(
  'meta_ad_service',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    metaAdId: text('meta_ad_id')
      .notNull()
      .references(() => metaAd.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => organizationService.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('meta_ad_service_unique').on(table.metaAdId, table.serviceId),
    index('idx_meta_ad_service_service_id').on(table.serviceId),
  ]
);

// ==================== RELATIONS ====================

export const metaAdRelations = relations(metaAd, ({ one, many }) => ({
  organization: one(organization, {
    fields: [metaAd.organizationId],
    references: [organization.id],
  }),
  video: one(video, {
    fields: [metaAd.videoId],
    references: [video.id],
  }),
  leadForm: one(leadForm, {
    fields: [metaAd.leadFormId],
    references: [leadForm.id],
  }),
  sequence: one(sequence, {
    fields: [metaAd.sequenceId],
    references: [sequence.id],
  }),
  page: one(metaAdsPage, {
    fields: [metaAd.metaAdsPageId],
    references: [metaAdsPage.id],
  }),
  socialPost: one(socialPost, {
    fields: [metaAd.socialPostId],
    references: [socialPost.id],
  }),
  services: many(metaAdService),
}));

export const metaAdServiceRelations = relations(metaAdService, ({ one }) => ({
  metaAd: one(metaAd, {
    fields: [metaAdService.metaAdId],
    references: [metaAd.id],
  }),
  service: one(organizationService, {
    fields: [metaAdService.serviceId],
    references: [organizationService.id],
  }),
}));

// ==================== CAMPAIGN CONFIG TABLE ====================

/**
 * Local campaign configuration that Meta doesn't know about.
 * Stores follow-up type, chatbot selection, conversion destination, and location
 * as campaign-level settings.
 */
export const metaCampaignConfig = pgTable(
  'meta_campaign_config',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // The Meta campaign ID this config belongs to
    metaCampaignId: text('meta_campaign_id').notNull().unique(),

    // Organization scope
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    // Page + ad account snapshot (immutable — set at campaign creation)
    metaAdsPageId: text('meta_ads_page_id').references(() => metaAdsPage.id, {
      onDelete: 'set null',
    }),
    adAccountId: text('ad_account_id'),
    adAccountCurrency: text('ad_account_currency'),

    // Follow-up configuration
    followUpType: followUpTypeEnum('follow_up_type')
      .notNull()
      .default('lead_form'),

    // Conversion destination (only when followUpType = chatbot)
    conversionDestination: conversionDestinationEnum('conversion_destination'),

    // Meta destination type for chatbot campaigns (e.g. WHATSAPP, MESSENGER,
    // MESSAGING_MESSENGER_WHATSAPP). Set at campaign creation, determines
    // the optimization goal for all ad sets in the campaign.
    destinationType: text('destination_type'),

    // Lead form used by this campaign (only when followUpType = lead_form).
    // Set at campaign creation; ads launched in the campaign inherit it when
    // they don't specify their own.
    leadFormId: text('lead_form_id').references(() => leadForm.id, {
      onDelete: 'set null',
    }),

    /**
     * The BRANCH this campaign targets.
     *
     * The single geo input: its geocoded coordinates centre the radius, its
     * address is the label shown on review cards, and (once branch-aware
     * booking lands) its slug is where the ad's clicks land. Targeting used to
     * accept raw coordinates from the caller — including a language model —
     * which is how an ad ran targeted at Null Island.
     *
     * Nullable for campaigns created before this became the input; `set null`
     * so deleting a branch never deletes the campaign history that spent money.
     */
    locationId: text('location_id').references(() => organizationLocation.id, {
      onDelete: 'set null',
    }),

    // Campaign-level targeting configuration
    targeting: jsonb('targeting').$type<MetaTargeting>(),

    // Meta ad set ID created with this campaign
    metaAdSetId: text('meta_ad_set_id'),

    // Experiment tracking (nullable — only set when campaign is part of an experiment)
    experimentId: text('experiment_id').references(() => experiment.id, {
      onDelete: 'set null',
    }),
    experimentVariant: text('experiment_variant'),

    // Timestamps
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_meta_campaign_config_org_id').on(table.organizationId),
    index('idx_meta_campaign_config_page_id').on(table.metaAdsPageId),
  ]
);

export const metaCampaignConfigRlsPolicy = orgRlsPolicy(metaCampaignConfig);

export const metaCampaignConfigRelations = relations(
  metaCampaignConfig,
  ({ one }) => ({
    organization: one(organization, {
      fields: [metaCampaignConfig.organizationId],
      references: [organization.id],
    }),
    page: one(metaAdsPage, {
      fields: [metaCampaignConfig.metaAdsPageId],
      references: [metaAdsPage.id],
    }),
    experiment: one(experiment, {
      fields: [metaCampaignConfig.experimentId],
      references: [experiment.id],
    }),
  })
);

// Bucket B2: meta_ad_service is a join table (meta_ad ↔ organization_service).
// Both parents are org-scoped. We route via meta_ad_id because meta_ad has
// organization_id indexed (idx_meta_ad_org_id).
export const metaAdServiceRlsPolicy = joinRlsPolicy(metaAdService, {
  parent: 'meta_ad',
  fk: 'meta_ad_id',
});

// ==================== TYPE EXPORTS ====================

export type MetaAd = typeof metaAd.$inferSelect;
export type NewMetaAd = typeof metaAd.$inferInsert;
export type MetaAdService = typeof metaAdService.$inferSelect;
export type NewMetaAdService = typeof metaAdService.$inferInsert;
export type MetaCampaignConfig = typeof metaCampaignConfig.$inferSelect;
export type NewMetaCampaignConfig = typeof metaCampaignConfig.$inferInsert;
