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
import { childOrgRlsPolicy, orgRlsPolicy } from '../rls-policy.js';
import { lead } from './leads.js';
import { organization } from './organization.js';
import { user } from './user.js';

// Import labels from enums (pure TypeScript)
import {
  campaignChannelLabels,
  campaignChannelValues,
  campaignEventTypeLabels,
  campaignEventTypeValues,
  campaignRecipientStatusLabels,
  campaignRecipientStatusValues,
  campaignStatusLabels,
  campaignStatusValues,
  campaignTypeLabels,
  campaignTypeValues,
  smsNumberStatusLabels,
  smsNumberStatusValues,
  smsSenderModeLabels,
  smsSenderModeValues,
  suppressionReasonLabels,
  suppressionReasonValues,
  whatsappTemplateStatusLabels,
  whatsappTemplateStatusValues,
} from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export {
  campaignTypeLabels,
  campaignTypeValues,
  campaignStatusLabels,
  campaignStatusValues,
  campaignChannelLabels,
  campaignChannelValues,
  campaignRecipientStatusLabels,
  campaignRecipientStatusValues,
  campaignEventTypeLabels,
  campaignEventTypeValues,
  suppressionReasonLabels,
  suppressionReasonValues,
  whatsappTemplateStatusLabels,
  whatsappTemplateStatusValues,
  smsNumberStatusLabels,
  smsNumberStatusValues,
  smsSenderModeLabels,
  smsSenderModeValues,
};
export type {
  CampaignType,
  CampaignStatus,
  CampaignChannel,
  CampaignRecipientStatus,
  CampaignEventType,
  SuppressionReason,
  WhatsappTemplateStatus,
  SmsNumberStatus,
  SmsSenderMode,
} from '@borradh-workspace/labels';

// =============================================================================
// ENUMS
// =============================================================================

export const campaignTypeEnum = pgEnum('campaign_type', campaignTypeValues);
export const campaignStatusEnum = pgEnum(
  'campaign_status',
  campaignStatusValues
);
export const campaignChannelEnum = pgEnum(
  'campaign_channel',
  campaignChannelValues
);
export const campaignRecipientStatusEnum = pgEnum(
  'campaign_recipient_status',
  campaignRecipientStatusValues
);
export const campaignEventTypeEnum = pgEnum(
  'campaign_event_type',
  campaignEventTypeValues
);
export const suppressionReasonEnum = pgEnum(
  'suppression_reason',
  suppressionReasonValues
);
export const whatsappTemplateStatusEnum = pgEnum(
  'whatsapp_template_status',
  whatsappTemplateStatusValues
);
export const smsNumberStatusEnum = pgEnum(
  'sms_number_status',
  smsNumberStatusValues
);
export const smsSenderModeEnum = pgEnum('sms_sender_mode', smsSenderModeValues);

// =============================================================================
// TYPED JSONB SHAPES
// =============================================================================

/**
 * A saved/reusable audience filter. Mirrors the lead-filter input the
 * list-leads service accepts, so segment evaluation reuses the same query
 * builder. Extended (vs. list-leads) with createdAt / lastContactedAt windows.
 */
export interface SegmentFilter {
  status?: string[];
  source?: string[];
  tags?: string[];
  search?: string;
  consentEmail?: boolean;
  consentSms?: boolean;
  createdFrom?: string; // ISO date
  createdTo?: string; // ISO date
  lastContactedBefore?: string; // ISO date — recency / re-engagement window
  lastContactedAfter?: string;
}

// =============================================================================
// TABLES
// =============================================================================

/** Campaign master record. One per blast (drip later via `sequenceId`). */
export const campaign = pgTable(
  'campaign',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: campaignTypeEnum('type').notNull().default('custom'),
    status: campaignStatusEnum('status').notNull().default('draft'),
    // Channels selected for this campaign (subset of campaign_channel values).
    channels: text('channels').array().notNull(),
    segmentId: text('segment_id').references(() => segment.id, {
      onDelete: 'set null',
    }),
    // Future drip link — a campaign can later be driven by a sequence.
    sequenceId: text('sequence_id'),
    scheduledAt: timestamp('scheduled_at'),
    sentAt: timestamp('sent_at'),
    createdById: text('created_by_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    index('idx_campaign_org_id').on(table.organizationId),
    index('idx_campaign_status').on(table.status),
    index('idx_campaign_segment_id').on(table.segmentId),
  ]
);

export const campaignRlsPolicy = orgRlsPolicy(campaign);

/** Saved/reusable audience. */
export const segment = pgTable(
  'segment',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    filterJson: jsonb('filter_json').$type<SegmentFilter>().notNull(),
    // true → re-evaluate the filter at send time; false → frozen snapshot.
    isDynamic: boolean('is_dynamic').notNull().default(true),
    createdById: text('created_by_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [index('idx_segment_org_id').on(table.organizationId)]
);

export const segmentRlsPolicy = orgRlsPolicy(segment);

/** Per-channel content for a campaign. */
export const campaignMessage = pgTable(
  'campaign_message',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaign.id, { onDelete: 'cascade' }),
    channel: campaignChannelEnum('channel').notNull(),
    subject: text('subject'),
    body: text('body').notNull(),
    whatsappTemplateId: text('whatsapp_template_id').references(
      () => whatsappTemplate.id,
      { onDelete: 'set null' }
    ),
    // Ordered values for the template's {{1}}..{{n}} placeholders. Each entry
    // may itself contain campaign merge tags ({{firstName|there}}) that are
    // interpolated per lead at send time.
    whatsappTemplateParams: jsonb('whatsapp_template_params').$type<string[]>(),
    mediaUrl: text('media_url'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_campaign_message_campaign_id').on(table.campaignId),
    // One message row per (campaign, channel).
    unique('uq_campaign_message_campaign_channel').on(
      table.campaignId,
      table.channel
    ),
  ]
);

export const campaignMessageRlsPolicy = childOrgRlsPolicy(campaignMessage, {
  parent: 'campaign',
  fk: 'campaign_id',
});

/**
 * Materialized send list + attribution backbone. The unique constraint on
 * (campaign_id, lead_id, channel) is the first line of the no-double-send
 * guarantee — a lead in two segments or a re-launch can't insert twice.
 */
export const campaignRecipient = pgTable(
  'campaign_recipient',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaign.id, { onDelete: 'cascade' }),
    leadId: text('lead_id')
      .notNull()
      .references(() => lead.id, { onDelete: 'cascade' }),
    channel: campaignChannelEnum('channel').notNull(),
    status: campaignRecipientStatusEnum('status').notNull().default('queued'),
    providerMessageId: text('provider_message_id'),
    error: text('error'),
    sentAt: timestamp('sent_at'),
    deliveredAt: timestamp('delivered_at'),
    openedAt: timestamp('opened_at'),
    clickedAt: timestamp('clicked_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_campaign_recipient_campaign_id').on(table.campaignId),
    index('idx_campaign_recipient_lead_id').on(table.leadId),
    index('idx_campaign_recipient_status').on(table.status),
    index('idx_campaign_recipient_provider_msg_id').on(table.providerMessageId),
    unique('uq_campaign_recipient_campaign_lead_channel').on(
      table.campaignId,
      table.leadId,
      table.channel
    ),
  ]
);

export const campaignRecipientRlsPolicy = childOrgRlsPolicy(campaignRecipient, {
  parent: 'campaign',
  fk: 'campaign_id',
});

/** Append-only tracking events (funnel + attribution). */
export const campaignEvent = pgTable(
  'campaign_event',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaign.id, { onDelete: 'cascade' }),
    recipientId: text('recipient_id').references(() => campaignRecipient.id, {
      onDelete: 'cascade',
    }),
    type: campaignEventTypeEnum('type').notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_campaign_event_campaign_id').on(table.campaignId),
    index('idx_campaign_event_recipient_id').on(table.recipientId),
    index('idx_campaign_event_type').on(table.type),
  ]
);

export const campaignEventRlsPolicy = childOrgRlsPolicy(campaignEvent, {
  parent: 'campaign',
  fk: 'campaign_id',
});

/**
 * Org-level suppression list. Keyed by `contact` (normalized email/phone),
 * NOT leadId, so an opt-out persists even if the lead row is later deleted.
 */
export const suppression = pgTable(
  'suppression',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    channel: campaignChannelEnum('channel').notNull(),
    contact: text('contact').notNull(),
    reason: suppressionReasonEnum('reason').notNull(),
    source: text('source'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_suppression_org_id').on(table.organizationId),
    unique('uq_suppression_org_channel_contact').on(
      table.organizationId,
      table.channel,
      table.contact
    ),
  ]
);

export const suppressionRlsPolicy = orgRlsPolicy(suppression);

/** Per-customer Twilio number (local, attached to centralized 10DLC). */
export const orgSmsNumber = pgTable(
  'org_sms_number',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    phoneNumber: text('phone_number').notNull(),
    twilioSid: text('twilio_sid').notNull(),
    country: text('country').notNull(),
    tenDlcCampaignSid: text('ten_dlc_campaign_sid'),
    status: smsNumberStatusEnum('status').notNull().default('provisioning'),
    // Whether Claire answers inbound SMS on this number.
    //
    // Deliberately defaults TRUE, unlike the same flag on metaAdsPage /
    // whatsappAccount / instagramIntegration which default false. Those
    // connections exist for other reasons and may be linked without wanting a
    // bot; an SMS number is only ever provisioned to hold two-way Claire
    // conversations, so answering is the expected behaviour and this is an
    // off switch rather than an opt-in.
    isChatbotActive: boolean('is_chatbot_active').default(true).notNull(),
    provisionedAt: timestamp('provisioned_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One active number per org (the brief's per-customer model).
    unique('uq_org_sms_number_org_id').on(table.organizationId),
  ]
);

export const orgSmsNumberRlsPolicy = orgRlsPolicy(orgSmsNumber);

/**
 * How an org sends campaign SMS. Absent row ⇒ the alpha default: derive a
 * branded sender ID from the org name at send time. A row lets an org override
 * the derived sender ID or switch to `number` mode (the dedicated-number
 * receptionist path, resolved from `org_sms_number`). See
 * docs/plans/sms-alphanumeric-v1.md.
 */
export const orgSmsSender = pgTable(
  'org_sms_sender',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    mode: smsSenderModeEnum('mode').notNull().default('alpha'),
    // The alphanumeric sender ID (≤11 chars). Null ⇒ derive from the org name.
    // Unused in `number` mode (sender comes from org_sms_number).
    senderId: text('sender_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [unique('uq_org_sms_sender_org_id').on(table.organizationId)]
);
export const orgSmsSenderRlsPolicy = orgRlsPolicy(orgSmsSender);

/** Per-org WhatsApp template approval lifecycle (cache of Meta state). */
export const whatsappTemplate = pgTable(
  'whatsapp_template',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    languageCode: text('language_code').notNull().default('en'),
    category: text('category'),
    status: whatsappTemplateStatusEnum('status').notNull().default('pending'),
    body: text('body').notNull(),
    metaTemplateId: text('meta_template_id'),
    syncedAt: timestamp('synced_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_whatsapp_template_org_id').on(table.organizationId),
    unique('uq_whatsapp_template_org_name_lang').on(
      table.organizationId,
      table.name,
      table.languageCode
    ),
  ]
);

export const whatsappTemplateRlsPolicy = orgRlsPolicy(whatsappTemplate);

/**
 * Email sender identity — v1 always resolves to the shared
 * `campaign.borradh.io` subdomain (`subdomain` nullable). Kept as a table so
 * per-tenant subdomain isolation can be added later without a migration.
 */
export const emailSenderIdentity = pgTable(
  'email_sender_identity',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    subdomain: text('subdomain'),
    displayName: text('display_name'),
    replyTo: text('reply_to'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('uq_email_sender_identity_org_id').on(table.organizationId),
  ]
);

export const emailSenderIdentityRlsPolicy = orgRlsPolicy(emailSenderIdentity);

// =============================================================================
// RELATIONS
// =============================================================================

export const campaignRelations = relations(campaign, ({ one, many }) => ({
  organization: one(organization, {
    fields: [campaign.organizationId],
    references: [organization.id],
  }),
  segment: one(segment, {
    fields: [campaign.segmentId],
    references: [segment.id],
  }),
  messages: many(campaignMessage),
  recipients: many(campaignRecipient),
  events: many(campaignEvent),
}));

export const segmentRelations = relations(segment, ({ one, many }) => ({
  organization: one(organization, {
    fields: [segment.organizationId],
    references: [organization.id],
  }),
  campaigns: many(campaign),
}));

export const campaignMessageRelations = relations(
  campaignMessage,
  ({ one }) => ({
    campaign: one(campaign, {
      fields: [campaignMessage.campaignId],
      references: [campaign.id],
    }),
    whatsappTemplate: one(whatsappTemplate, {
      fields: [campaignMessage.whatsappTemplateId],
      references: [whatsappTemplate.id],
    }),
  })
);

export const campaignRecipientRelations = relations(
  campaignRecipient,
  ({ one, many }) => ({
    campaign: one(campaign, {
      fields: [campaignRecipient.campaignId],
      references: [campaign.id],
    }),
    lead: one(lead, {
      fields: [campaignRecipient.leadId],
      references: [lead.id],
    }),
    events: many(campaignEvent),
  })
);

export const campaignEventRelations = relations(campaignEvent, ({ one }) => ({
  campaign: one(campaign, {
    fields: [campaignEvent.campaignId],
    references: [campaign.id],
  }),
  recipient: one(campaignRecipient, {
    fields: [campaignEvent.recipientId],
    references: [campaignRecipient.id],
  }),
}));

// =============================================================================
// TYPES
// =============================================================================

export type Campaign = typeof campaign.$inferSelect;
export type NewCampaign = typeof campaign.$inferInsert;
export type Segment = typeof segment.$inferSelect;
export type NewSegment = typeof segment.$inferInsert;
export type CampaignMessage = typeof campaignMessage.$inferSelect;
export type NewCampaignMessage = typeof campaignMessage.$inferInsert;
export type CampaignRecipient = typeof campaignRecipient.$inferSelect;
export type NewCampaignRecipient = typeof campaignRecipient.$inferInsert;
export type CampaignEvent = typeof campaignEvent.$inferSelect;
export type NewCampaignEvent = typeof campaignEvent.$inferInsert;
export type Suppression = typeof suppression.$inferSelect;
export type NewSuppression = typeof suppression.$inferInsert;
export type OrgSmsNumber = typeof orgSmsNumber.$inferSelect;
export type NewOrgSmsNumber = typeof orgSmsNumber.$inferInsert;
export type OrgSmsSender = typeof orgSmsSender.$inferSelect;
export type NewOrgSmsSender = typeof orgSmsSender.$inferInsert;
export type WhatsappTemplate = typeof whatsappTemplate.$inferSelect;
export type NewWhatsappTemplate = typeof whatsappTemplate.$inferInsert;
export type EmailSenderIdentity = typeof emailSenderIdentity.$inferSelect;
export type NewEmailSenderIdentity = typeof emailSenderIdentity.$inferInsert;
