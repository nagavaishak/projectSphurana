/**
 * Campaigns / ads response PROJECTIONS — hand-composed from generated atoms.
 *
 * Three response surfaces live here (one barrel namespace, so names are
 * distinctively prefixed):
 *
 *  - META CAMPAIGNS (`meta-campaigns/*`) — campaigns are fetched LIVE from the
 *    Meta API, not a DB table, so their entity + insights shapes are
 *    hand-modelled `z.object`s (no atom). Config extras join off
 *    `meta_campaign_config`.
 *  - META ADS (`meta-ads/*`) — the `meta_ad` atom, narrowed for the wire
 *    (`callToAction` non-null, `targetingOverride` typed, optional joined
 *    video / graphic / services).
 *  - MESSAGING CAMPAIGNS (`campaigns/*`) — the bulk SMS/email/WhatsApp blast
 *    product: `campaign` / `campaign_message` / `campaign_recipient` / `segment`
 *    / `suppression` / `org_sms_number` atoms plus computed list / analytics /
 *    preview shapes.
 *
 * Pure Zod, composed with `z.object` / `.extend` / `z.array` / `z.record`. Dates
 * are ISO strings (atoms already wire-shaped). See ./leads.ts for the pattern.
 */
import { z } from 'zod';
import {
  campaignAtomSchema,
  campaignMessageAtomSchema,
  campaignRecipientAtomSchema,
  metaAdAtomSchema,
  orgSmsNumberAtomSchema,
  segmentAtomSchema,
  suppressionAtomSchema,
  whatsappTemplateAtomSchema,
} from '../generated/index.js';

// ============================================================================
// META CAMPAIGNS — live from Meta API (no backing DB table)
// ============================================================================

/**
 * A campaign as returned by `GET /meta-campaigns` — the live Meta campaign
 * (`MetaCampaignData`) merged with local ad-count / creative-thumbnail
 * enrichment and the optional `meta_campaign_config` extras. `status` /
 * `objective` are free-text on the wire (Meta returns raw strings), so they
 * stay `z.string()` — not narrowed to the DB enums.
 */
export const metaCampaignListEntrySchema = z.object({
  // MetaCampaignData (live from Meta)
  id: z.string(),
  name: z.string(),
  status: z.string(),
  effectiveStatus: z.string(),
  objective: z.string(),
  dailyBudget: z.string().optional(),
  lifetimeBudget: z.string().optional(),
  createdTime: z.string().optional(),
  updatedTime: z.string().optional(),
  // Local enrichment
  adCount: z.number(),
  previewImageUrl: z.string().nullable(),
  // Optional meta_campaign_config extras
  followUpType: z.string().optional(),
  conversionDestination: z.string().nullable().optional(),
  locationId: z.string().nullable().optional(),
  targeting: z.record(z.string(), z.unknown()).nullable().optional(),
  metaAdSetId: z.string().nullable().optional(),
});
export type MetaCampaignListEntry = z.infer<typeof metaCampaignListEntrySchema>;

/** `GET /meta-campaigns` — the `{ campaigns }` wrapper (bare, no pagination). */
export const listMetaCampaignsResponseSchema = z.object({
  campaigns: z.array(metaCampaignListEntrySchema),
});
export type ListMetaCampaignsResponse = z.infer<
  typeof listMetaCampaignsResponseSchema
>;

/** `POST /meta-campaigns` — the created Meta campaign + ad set ids. */
export const createMetaCampaignResponseSchema = z.object({
  metaCampaignId: z.string(),
  metaAdSetId: z.string(),
  followUpType: z.string(),
  conversionDestination: z.string().optional(),
  /**
   * The BRANCH the campaign targets, echoed back because the caller does not
   * choose the coordinates any more — it names a branch (or names nothing and
   * gets the default one), so this is how a confirmation card can state what
   * was actually targeted rather than what was asked for.
   */
  location: z
    .object({
      id: z.string(),
      label: z.string(),
    })
    .optional(),
});
export type CreateMetaCampaignResponse = z.infer<
  typeof createMetaCampaignResponseSchema
>;

/** Aggregate performance totals for a campaign (spend/cpc/cpm in cents). */
export const campaignInsightsTotalsSchema = z.object({
  impressions: z.number(),
  reach: z.number(),
  clicks: z.number(),
  spend: z.number(),
  cpc: z.number(),
  cpm: z.number(),
  ctr: z.number(),
  frequency: z.number(),
  leads: z.number(),
  conversions: z.number(),
});
export type CampaignInsightsTotals = z.infer<
  typeof campaignInsightsTotalsSchema
>;

/** Per-ad performance breakdown within a campaign's insights. */
export const campaignInsightsAdRowSchema = z.object({
  adId: z.string(),
  adName: z.string(),
  impressions: z.number(),
  reach: z.number(),
  clicks: z.number(),
  spend: z.number(),
  cpc: z.number(),
  cpm: z.number(),
  ctr: z.number(),
});
export type CampaignInsightsAdRow = z.infer<typeof campaignInsightsAdRowSchema>;

/** `GET /meta-campaigns/:id/insights` — one campaign's insights from Meta. */
export const metaCampaignInsightsSchema = z.object({
  metaCampaignId: z.string(),
  dateRange: z.object({ since: z.string(), until: z.string() }),
  totals: campaignInsightsTotalsSchema,
  ads: z.array(campaignInsightsAdRowSchema),
});
export type MetaCampaignInsights = z.infer<typeof metaCampaignInsightsSchema>;

/** Insights for a single campaign in the batched response. */
export const campaignInsightsSummarySchema = z.object({
  metaCampaignId: z.string(),
  totals: campaignInsightsTotalsSchema,
});
export type CampaignInsightsSummary = z.infer<
  typeof campaignInsightsSummarySchema
>;

/** `GET /meta-campaigns/insights` — batched insights for every campaign. */
export const listCampaignInsightsResponseSchema = z.object({
  dateRange: z.object({ since: z.string(), until: z.string() }),
  insights: z.array(campaignInsightsSummarySchema),
});
export type ListCampaignInsightsResponse = z.infer<
  typeof listCampaignInsightsResponseSchema
>;

/**
 * `POST /meta-campaigns/:id/pause` — pause acknowledgement with the campaign
 * `effective_status` READ BACK from Meta after the mutation (ADR-005).
 * `campaignEffectiveStatus` is null / `verified` false when the read-back
 * failed — consumers must then report "submitted, unverified", not "paused".
 */
export const pauseCampaignResponseSchema = z.object({
  paused: z.literal(true),
  campaignEffectiveStatus: z.string().nullable().optional(),
  verified: z.boolean().optional(),
});
export type PauseCampaignResponse = z.infer<typeof pauseCampaignResponseSchema>;

/**
 * `POST /meta-campaigns/:id/resume` — resume acknowledgement. `status` is the
 * read-back `effective_status` (or `'UNVERIFIED'`), never an assumed 'ACTIVE'.
 */
export const resumeCampaignResponseSchema = z.object({
  metaCampaignId: z.string(),
  status: z.string(),
  campaignEffectiveStatus: z.string().nullable().optional(),
  verified: z.boolean().optional(),
});
export type ResumeCampaignResponse = z.infer<
  typeof resumeCampaignResponseSchema
>;

/**
 * `PUT /meta-campaigns/:id` — update acknowledgement with the campaign
 * `effective_status` read back from Meta after the mutation (ADR-005).
 */
export const updateMetaCampaignResponseSchema = z.object({
  updated: z.literal(true),
  campaignEffectiveStatus: z.string().nullable().optional(),
  verified: z.boolean().optional(),
});
export type UpdateMetaCampaignResponse = z.infer<
  typeof updateMetaCampaignResponseSchema
>;

/** `POST /meta-campaigns/:id/duplicate` — the enqueue acknowledgement. */
export const queueDuplicateCampaignResponseSchema = z.object({
  queued: z.boolean(),
});
export type QueueDuplicateCampaignResponse = z.infer<
  typeof queueDuplicateCampaignResponseSchema
>;

// ============================================================================
// META ADS — the meta_ad atom, narrowed for the wire
// ============================================================================

/**
 * Ad targeting override (`meta_ad.targeting_override`, a `$type<MetaTargeting>`
 * jsonb the generator widens to `z.unknown()`). Hand-narrowed to the
 * `MetaTargeting` shape so the projection matches the api-client `Ad` type.
 */
export const campaignTargetingSchema = z.object({
  location: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  distanceKm: z.number().optional(),
  ageMin: z.number().optional(),
  ageMax: z.number().optional(),
  genders: z.array(z.number()).optional(),
  countries: z.array(z.string()).optional(),
});
export type CampaignTargeting = z.infer<typeof campaignTargetingSchema>;

/** Joined video reference for video ads. */
export const adVideoSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  videoUrl: z.string().nullable(),
  duration: z.number().nullable(),
  // Intrinsic size, set for asset-backed creatives. Zod STRIPS unknown keys,
  // so a field missing here never reaches the client no matter what the
  // service returns.
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
});
export type AdVideo = z.infer<typeof adVideoSchema>;

/**
 * An ad as returned by the ad endpoints — the `meta_ad` atom with wire
 * narrowings: `callToAction` is non-null (DB defaults to `LEARN_MORE`),
 * `targetingOverride` is the typed `MetaTargeting`, plus optionally-joined
 * `video`, `graphicImageUrl` and `services`.
 */
export const adSchema = metaAdAtomSchema
  .omit({ callToAction: true, targetingOverride: true })
  .extend({
    callToAction: metaAdAtomSchema.shape.callToAction.unwrap(),
    targetingOverride: campaignTargetingSchema.nullable(),
    video: adVideoSchema.optional(),
    graphicImageUrl: z.string().nullable().optional(),
    graphicImageWidth: z.number().nullable().optional(),
    graphicImageHeight: z.number().nullable().optional(),
    services: z
      .array(z.object({ id: z.string(), name: z.string() }))
      .optional(),
  });
export type Ad = z.infer<typeof adSchema>;

/** `GET /meta-ads/campaigns/:metaCampaignId` — list of ads for a campaign. */
export const listAdsResponseSchema = z.object({
  ads: z.array(adSchema),
  total: z.number(),
});
export type ListAdsResponse = z.infer<typeof listAdsResponseSchema>;

/** `POST /meta-ads/:id/sync` — the synced ad plus the sync flag. */
export const syncAdResponseSchema = z.object({
  ad: adSchema,
  synced: z.boolean(),
});
export type SyncAdResponse = z.infer<typeof syncAdResponseSchema>;

/** `POST /meta-ads/import` — import outcome counters. */
export const importAdsResponseSchema = z.object({
  imported: z.number(),
  skipped: z.number(),
  total: z.number(),
});
export type ImportAdsResponse = z.infer<typeof importAdsResponseSchema>;

// ============================================================================
// MESSAGING CAMPAIGNS — bulk SMS/email/WhatsApp blasts
// ============================================================================

/** A messaging-campaign header row — the atom, verbatim. */
export const messagingCampaignSchema = campaignAtomSchema;
export type MessagingCampaign = z.infer<typeof messagingCampaignSchema>;

/**
 * A per-channel message body attached to a campaign — the atom with
 * `whatsappTemplateParams` narrowed from jsonb-`unknown` to the ordered
 * {{1}}..{{n}} template param strings.
 */
export const campaignMessageSchema = campaignMessageAtomSchema.extend({
  whatsappTemplateParams: z.array(z.string()).nullable(),
});
export type CampaignMessage = z.infer<typeof campaignMessageSchema>;

/** A materialized send (lead × channel) ledger row — the atom, verbatim. */
export const campaignRecipientSchema = campaignRecipientAtomSchema;
export type CampaignRecipient = z.infer<typeof campaignRecipientSchema>;

/**
 * The persisted audience filter (`segment.filter_json`, a `$type<SegmentFilter>`
 * jsonb the generator widens to `z.unknown()`). Hand-narrowed to match.
 */
export const segmentFilterSchema = z.object({
  status: z.array(z.string()).optional(),
  source: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  search: z.string().optional(),
  consentEmail: z.boolean().optional(),
  consentSms: z.boolean().optional(),
  createdFrom: z.string().optional(),
  createdTo: z.string().optional(),
  lastContactedBefore: z.string().optional(),
  lastContactedAfter: z.string().optional(),
});
export type SegmentFilter = z.infer<typeof segmentFilterSchema>;

/** An audience segment — the atom with `filterJson` narrowed to `SegmentFilter`. */
export const segmentSchema = segmentAtomSchema.extend({
  filterJson: segmentFilterSchema,
});
export type Segment = z.infer<typeof segmentSchema>;

/**
 * `GET /campaigns/entitlements` — which channels the org's plan allows.
 *
 * `checkChannelEntitlement` returns `{ allowed, blocked }`, and
 * `blocked[].reason` is a reason CODE rather than prose — the service's only
 * member is `ChannelBlockReasons.REQUIRES_PAID_PLAN`. Modelled as an enum, not
 * `z.string()`, so adding a block reason without teaching the callers about it
 * fails here instead of rendering a raw code at an operator.
 */
export const channelEntitlementsResponseSchema = z.object({
  allowed: z.array(campaignMessageAtomSchema.shape.channel),
  blocked: z.array(
    z.object({
      channel: campaignMessageAtomSchema.shape.channel,
      reason: z.enum(['requires_paid_plan']),
    })
  ),
});
export type ChannelEntitlementsResponse = z.infer<
  typeof channelEntitlementsResponseSchema
>;

/**
 * A WhatsApp message template mirrored from the org's linked WABA — the atom,
 * verbatim. `syncWhatsappTemplates` reads the cache with a bare `findMany` (no
 * column projection), so the whole row is what reaches the wire.
 */
export const whatsappTemplateSchema = whatsappTemplateAtomSchema;
export type WhatsappTemplateResponse = z.infer<typeof whatsappTemplateSchema>;

/** `GET /campaigns/whatsapp-templates` — `{ templates, synced }`. */
export const listWhatsappTemplatesResponseSchema = z.object({
  templates: z.array(whatsappTemplateSchema),
  /** True when this call re-synced from Meta (vs a pure cache read). */
  synced: z.boolean(),
});
export type ListWhatsappTemplatesResponse = z.infer<
  typeof listWhatsappTemplatesResponseSchema
>;

/** A per-channel suppression (opt-out / bounce) entry — the atom, verbatim. */
export const suppressionSchema = suppressionAtomSchema;
export type Suppression = z.infer<typeof suppressionSchema>;

/** The org's campaign SMS sender number — the atom, verbatim. */
export const smsNumberSchema = orgSmsNumberAtomSchema;
export type SmsNumber = z.infer<typeof smsNumberSchema>;

/**
 * `GET /campaigns/sms-number` — the org's number, or `null` when none is
 * provisioned.
 */
export const smsNumberOrNullSchema = smsNumberSchema.nullable();

/** A purchasable Twilio number (`GET /campaigns/sms-number/available`). */
export const availableSmsNumberSchema = z.object({
  phoneNumber: z.string(),
  friendlyName: z.string(),
  locality: z.string().optional(),
  region: z.string().optional(),
});
export type AvailableSmsNumber = z.infer<typeof availableSmsNumberSchema>;

/** `GET /campaigns/sms-number/available` — the bare array of numbers. */
export const availableSmsNumbersResponseSchema = z.array(
  availableSmsNumberSchema
);
export type AvailableSmsNumbersResponse = z.infer<
  typeof availableSmsNumbersResponseSchema
>;

/** `GET /campaigns/:id` — a campaign with its per-channel messages. */
export const messagingCampaignWithMessagesSchema = campaignAtomSchema.extend({
  messages: z.array(campaignMessageSchema),
});
export type MessagingCampaignWithMessages = z.infer<
  typeof messagingCampaignWithMessagesSchema
>;

/** A campaign list row — the campaign plus audience name + recipient counts. */
export const messagingCampaignListItemSchema = campaignAtomSchema.extend({
  segmentName: z.string().nullable(),
  recipientCounts: z.record(z.string(), z.number()),
});
export type MessagingCampaignListItem = z.infer<
  typeof messagingCampaignListItemSchema
>;

/** `GET /campaigns` — list projection: `{ items, total, limit, offset }`. */
export const messagingCampaignListResponseSchema = z.object({
  items: z.array(messagingCampaignListItemSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export type MessagingCampaignListResponse = z.infer<
  typeof messagingCampaignListResponseSchema
>;

/** `GET /campaigns/segments` — list projection. */
export const segmentListResponseSchema = z.object({
  items: z.array(segmentSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export type SegmentListResponse = z.infer<typeof segmentListResponseSchema>;

/** `POST /campaigns/segments/preview` — reach total + per-channel counts. */
export const segmentPreviewResponseSchema = z.object({
  total: z.number(),
  reachable: z.number(),
  channels: z.record(z.string(), z.number()),
});
export type SegmentPreviewResponse = z.infer<
  typeof segmentPreviewResponseSchema
>;

/** `POST /campaigns/:id/launch` — materialize + enqueue summary. */
export const launchCampaignResponseSchema = z.object({
  campaignId: z.string(),
  materialized: z.number(),
  enqueued: z.number(),
});
export type LaunchCampaignResponse = z.infer<
  typeof launchCampaignResponseSchema
>;

/**
 * `POST /campaigns/:id/{launch,resume,cancel}` — lifecycle endpoints return
 * either the materialize/enqueue summary (launch) or the updated campaign
 * (resume/cancel).
 */
export const campaignLifecycleResponseSchema = z.union([
  launchCampaignResponseSchema,
  messagingCampaignSchema,
]);
export type CampaignLifecycleResponse = z.infer<
  typeof campaignLifecycleResponseSchema
>;

/** `GET /campaigns/:id/analytics` — funnel counts derived from recipient rows. */
export const campaignAnalyticsSchema = z.object({
  total: z.number(),
  sent: z.number(),
  delivered: z.number(),
  failed: z.number(),
  optedOut: z.number(),
  opened: z.number(),
  clicked: z.number(),
});
export type CampaignAnalytics = z.infer<typeof campaignAnalyticsSchema>;

/** One per-recipient outcome row (`GET /campaigns/:id/recipients`). */
export const campaignRecipientRowSchema = z.object({
  id: z.string(),
  channel: campaignRecipientAtomSchema.shape.channel,
  status: z.string(),
  error: z.string().nullable(),
  contact: z.string().nullable(),
  name: z.string().nullable(),
  sentAt: z.string().datetime().nullable(),
});
export type CampaignRecipientRow = z.infer<typeof campaignRecipientRowSchema>;

/** `GET /campaigns/:id/recipients` — the bare array of recipient rows. */
export const listCampaignRecipientsResponseSchema = z.array(
  campaignRecipientRowSchema
);
export type ListCampaignRecipientsResponse = z.infer<
  typeof listCampaignRecipientsResponseSchema
>;
