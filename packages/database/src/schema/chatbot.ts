import {
  chatbotGoalLabels,
  chatbotGoalValues,
  chatbotToneLabels,
  chatbotToneValues,
  conversationStageLabels,
  conversationStageValues,
  conversationStatusLabels,
  conversationStatusValues,
  messageRoleLabels,
  messageRoleValues,
  messageTypeLabels,
  messageTypeValues,
  messagingPlatformLabels,
  messagingPlatformValues,
  toneRegionLabels,
  toneRegionValues,
} from '@borradh-workspace/labels';
import { createId } from '@paralleldrive/cuid2';
import { relations, sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { childOrgRlsPolicy, orgRlsPolicy } from '../rls-policy.js';
import { lead } from './leads.js';
import { metaAdsPage } from './meta-ads-pages.js';
import { organizationLocation } from './organization-location.js';
import { organization } from './organization.js';
import { user } from './user.js';
import { whatsappAccount } from './whatsapp-accounts.js';

// =============================================================================
// ENUMS (imported from canonical enums directory)
// =============================================================================

// Re-export labels and values for consumers
export {
  conversationStatusLabels,
  conversationStatusValues,
  messageRoleLabels,
  messageRoleValues,
  messageTypeLabels,
  messageTypeValues,
  messagingPlatformLabels,
  messagingPlatformValues,
  toneRegionLabels,
  toneRegionValues,
  conversationStageLabels,
  conversationStageValues,
  chatbotGoalLabels,
  chatbotGoalValues,
  chatbotToneLabels,
  chatbotToneValues,
};

// Re-export types
export type {
  ConversationStatus,
  MessageRole,
  MessageType,
  MessagingPlatform,
  ToneRegion,
  ConversationStage,
  ChatbotGoal,
  ChatbotTone,
} from '@borradh-workspace/labels';

// Import types for local use in interfaces
import type { ConversationStage } from '@borradh-workspace/labels';

// Database enums (only conversation/message-related)
export const conversationStatusEnum = pgEnum(
  'conversation_status',
  conversationStatusValues
);
export const messageRoleEnum = pgEnum('message_role', messageRoleValues);
export const messageTypeEnum = pgEnum('message_type', messageTypeValues);
export const messagingPlatformEnum = pgEnum(
  'messaging_platform',
  messagingPlatformValues
);

// =============================================================================
// Re-export ChatbotSettings from organization (for backwards compatibility)
// =============================================================================

export type {
  ChatbotSettings,
  ChatbotDifferentiators,
  ChatbotFaq,
  ChatbotConsultation,
  ChatbotAvailability,
} from './organization.js';

// =============================================================================
// CONVERSATION METADATA (typed JSONB)
// =============================================================================

/**
 * A booking slot offered to a lead in the direct-booking fallback flow.
 * Stored in `ConversationMetadata.offeredSlots` so the bot can match the
 * lead's reply against the originally-offered times.
 */
export interface OfferedSlot {
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  displayTime: string; // human-readable, e.g. "2:30 PM"
  isoStart: string;
  isoEnd: string;
  practitionerName?: string;
  practitionerId?: string;
}

export interface ConversationMetadata {
  // Collected contact info
  name?: string;
  phone?: string;
  email?: string;

  // Conversation tracking
  stage?: ConversationStage;
  treatmentsDiscussed?: string[];
  healthConcerns?: string[];
  bookingInterest?: boolean;
  bookingLinkSent?: boolean;
  bookingLinkSentAt?: string;
  escalationRequested?: boolean;

  // Follow-up tracking
  followUpSentAt?: string;
  followUpCount?: number;
  lastBotResponseAt?: string;
  contactDetailAsks?: number;

  // Booking push tracking (max 2 pushes per conversation)
  // Combined cap covering booking-link sends AND direct-slot offers.
  bookingPushCount?: number;

  // Direct-booking fallback (native-calendar orgs): once a booking link is
  // ignored past the timeout, the bot offers concrete slots and waits for a
  // selection. `offeredSlots` holds the snapshot used for slot matching.
  directBookingOfferedAt?: string;
  directBookingConfirmedAt?: string;
  offeredSlots?: OfferedSlot[];

  // v3.1 follow-up tracking
  followUpStage?: 1 | 2 | 3;
  dormant?: boolean;

  // Follow-up required (e.g. unknown service requested)
  needsFollowUp?: boolean;
  followUpReason?: string;
  followUpNotifiedAt?: string;

  // Escalation tracking
  escalationReason?: string;
  escalationDetail?: string;
  escalatedAt?: string;

  // Ad referral tracking
  adMetaId?: string;
  adInternalId?: string;
  adTitle?: string;
  // Ad creative from the Click-to-Messenger referral (`ads_context_data`).
  // Lets the inbox render a preview card of the ad the lead clicked instead
  // of an opaque attachment placeholder.
  adPhotoUrl?: string;
  adVideoUrl?: string;

  // Originating lead this conversation belongs to. Set when an inbound
  // message is linked to an existing lead (e.g. a Meta lead-form submission
  // whose follow-up message starts the chat). Lets the bot surface what the
  // customer originally enquired about.
  leadId?: string;

  // Set when an external send fails because the recipient itself is
  // unreachable (Meta `not_found` / `user_blocked` — e.g. code 100 subcode
  // 2018001 "No matching user found"). Durable so a later trigger
  // (follow_up/timeout/retry) doesn't silently re-attempt delivery and
  // re-log the same failure. Cleared only when a new inbound message from
  // this recipient proves they are reachable again.
  undeliverable?: {
    at: string;
    code?: number;
    subcode?: number;
    category: string;
    pageId?: string;
  };

  // Legacy: any other collected data from node-based flows
  [key: string]: unknown;
}

// =============================================================================
// TABLES
// =============================================================================

/**
 * Conversation - Chat session with an external user
 */
export const conversation = pgTable(
  'conversation',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    metaAdsPageId: text('meta_ads_page_id').references(() => metaAdsPage.id, {
      onDelete: 'set null',
    }),
    whatsappAccountId: text('whatsapp_account_id').references(
      () => whatsappAccount.id,
      { onDelete: 'set null' }
    ),

    // External user info (PSID for Messenger, IGSID for Instagram)
    externalUserId: text('external_user_id').notNull(),
    externalUserName: text('external_user_name'),
    externalUserAvatar: text('external_user_avatar'),

    // Platform and status
    platform: messagingPlatformEnum('platform').notNull(),
    status: conversationStatusEnum('status').notNull().default('bot_handling'),

    // Collected data, AI context, etc.
    metadata: jsonb('metadata').$type<ConversationMetadata>(),

    // Optimistic concurrency control
    version: integer('version').notNull().default(0),

    // Agent assignment
    assignedToId: text('assigned_to_id').references(() => user.id, {
      onDelete: 'set null',
    }),

    // Originating lead this conversation belongs to. A real FK (superseding the
    // legacy sparse `metadata.leadId` pointer) so the Clients list can order and
    // scope by "has an unread inbound message" through an index instead of a
    // jsonb scan. Set at conversation creation when the sender matches a lead,
    // and backfilled from psid / phone (see migration).
    leadId: text('lead_id').references(() => lead.id, { onDelete: 'set null' }),

    /**
     * The BRANCH this conversation is currently about.
     *
     * Resolved at creation from the ad's campaign
     * (`meta_campaign_config.location_id`), and updated when the customer names
     * a different branch. MUTABLE on purpose: a conversation row is unique on
     * `(organization_id, external_user_id, platform)` — one row per customer per
     * platform, reused for life — so this is "the branch of the current
     * intent", not an immutable property of the thread. A regular who asked
     * about Cork in March and Dublin in June is the same row.
     *
     * NULL means "never determined" — NOT "org-wide" and NOT "the default
     * branch". Every reader must treat NULL as today's un-scoped behaviour
     * rather than resolving a default, because resolving one would fabricate a
     * signal indistinguishable from a real one.
     *
     * `set null` rather than cascade: deleting a branch must never destroy a
     * conversation or the lead attribution hanging off it.
     *
     * NOTE: a foreign key does NOT enforce tenant isolation — Postgres validates
     * FKs internally, unfiltered by RLS — so the writing service must check the
     * branch belongs to this conversation's org.
     */
    locationId: text('location_id').references(() => organizationLocation.id, {
      onDelete: 'set null',
    }),

    // Timestamps
    lastMessageAt: timestamp('last_message_at'),
    closedAt: timestamp('closed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('unique_conversation_user').on(
      table.organizationId,
      table.externalUserId,
      table.platform
    ),
    index('idx_conversation_org_id').on(table.organizationId),
    index('idx_conversation_assigned_to_id').on(table.assignedToId),
    index('idx_conversation_lead_id').on(table.organizationId, table.leadId),
    // Mirrors idx_lead_org_primary_location: the inbox will filter by branch,
    // and reporting joins conversations to a branch's ads.
    index('idx_conversation_org_location').on(
      table.organizationId,
      table.locationId
    ),
  ]
);

/**
 * Structured payload for a non-text (or partially non-text) message, stored on
 * `conversation_message.metadata`. Meta delivers stickers, emoji reactions,
 * images and other attachments with an empty `text` field — without capturing
 * this, such messages render as blank bubbles in the inbox. Every field is
 * optional; `null`/absent metadata means a plain text message.
 */
export interface ConversationMessageAttachment {
  /** Normalized attachment kind. `unknown` keeps unexpected Meta types visible. */
  type:
    | 'image'
    | 'video'
    | 'audio'
    | 'file'
    | 'fallback'
    | 'share'
    | 'story_mention'
    | 'story_reply'
    | 'unknown';
  /** CDN URL for media attachments (image/video/audio/file), when provided. */
  url?: string;
  /** Optional human title (e.g. shared link title, fallback title). */
  title?: string;
}

export interface ConversationMessageMetadata {
  /** Media/file/share attachments carried by the message. */
  attachments?: ConversationMessageAttachment[];
  /** Meta sticker id (e.g. the thumbs-up "like" sticker). */
  stickerId?: string;
  /** CDN URL of the sticker image, when provided (renderable in the inbox). */
  stickerUrl?: string;
  /** True when the sticker is the Messenger/IG thumbs-up "like". */
  isLike?: boolean;
  /** Emoji character for a message reaction. */
  reaction?: string;
  /** Marks a page-side message imported by the conversation sync job. */
  synced?: boolean;
  /**
   * True when this page-side echo was the page's own Messenger auto-responder
   * (Instant Reply / away message), not a human agent. Auto-responders are
   * recorded for inbox completeness but must NOT count as a human takeover.
   */
  autoResponder?: boolean;
  /** Quick-reply buttons attached to a bot message. */
  options?: Array<{ label: string; value: string }>;
}

/**
 * ConversationMessage - Individual messages in a conversation
 */
export const conversationMessage = pgTable(
  'conversation_message',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    role: messageRoleEnum('role').notNull(),
    content: text('content').notNull(),
    messageType: messageTypeEnum('message_type').notNull().default('text'),

    // External message tracking
    externalMessageId: text('external_message_id'),

    // Origin tracking: how this message entered the system
    origin: text('origin')
      .$type<'live' | 'sync' | 'backfill'>()
      .notNull()
      .default('live'),

    // Extra data: stickers, emoji reactions, media/file attachments, etc.
    // See ConversationMessageMetadata. Null for plain text messages.
    metadata: jsonb('metadata').$type<ConversationMessageMetadata>(),

    // Delivery tracking
    sentAt: timestamp('sent_at'),
    deliveredAt: timestamp('delivered_at'),
    readAt: timestamp('read_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_conversation_message_conversation_id').on(table.conversationId),
    // Partial unique index: prevents duplicate external messages per conversation
    uniqueIndex('idx_conversation_message_ext_id')
      .on(table.conversationId, table.externalMessageId)
      .where(sql`external_message_id IS NOT NULL`),
    // Dedup lookup: find messages by conversation + role + timestamp
    index('idx_conversation_message_dedup').on(
      table.conversationId,
      table.role,
      table.sentAt
    ),
  ]
);

export const conversationRlsPolicy = orgRlsPolicy(conversation);

// Bucket B1: conversation_message has no organization_id; org scope derives
// from the parent conversation row via conversation_id FK.
export const conversationMessageRlsPolicy = childOrgRlsPolicy(
  conversationMessage,
  {
    parent: 'conversation',
    fk: 'conversation_id',
  }
);

// =============================================================================
// RELATIONS
// =============================================================================

export const conversationRelations = relations(
  conversation,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [conversation.organizationId],
      references: [organization.id],
    }),
    metaAdsPage: one(metaAdsPage, {
      fields: [conversation.metaAdsPageId],
      references: [metaAdsPage.id],
    }),
    whatsappAccount: one(whatsappAccount, {
      fields: [conversation.whatsappAccountId],
      references: [whatsappAccount.id],
    }),
    assignedTo: one(user, {
      fields: [conversation.assignedToId],
      references: [user.id],
    }),
    messages: many(conversationMessage),
  })
);

export const conversationMessageRelations = relations(
  conversationMessage,
  ({ one }) => ({
    conversation: one(conversation, {
      fields: [conversationMessage.conversationId],
      references: [conversation.id],
    }),
  })
);

// =============================================================================
// TYPES
// =============================================================================

export type Conversation = typeof conversation.$inferSelect;
export type NewConversation = typeof conversation.$inferInsert;
export type ConversationMessage = typeof conversationMessage.$inferSelect;
export type NewConversationMessage = typeof conversationMessage.$inferInsert;
