import {
  type AssistantPrimaryAction,
  assistantActionTypeLabels,
  assistantActionTypeValues,
  assistantConversationStatusLabels,
  assistantConversationStatusValues,
  assistantMessageRoleLabels,
  assistantMessageRoleValues,
  assistantRecommendationKindLabels,
  assistantRecommendationKindValues,
  assistantRecommendationStateLabels,
  assistantRecommendationStateValues,
  knowledgeEntryTypeLabels,
  knowledgeEntryTypeValues,
  knowledgeSourceLabels,
  knowledgeSourceValues,
} from '@borradh-workspace/labels';
import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  vector,
} from 'drizzle-orm/pg-core';
import { childOrgRlsPolicy, orgRlsPolicy } from '../rls-policy.js';
import { organization } from './organization.js';
import { user } from './user.js';

// =============================================================================
// ENUMS (imported from canonical enums directory)
// =============================================================================

// Re-export labels and values for consumers
export {
  assistantActionTypeLabels,
  assistantActionTypeValues,
  assistantConversationStatusLabels,
  assistantConversationStatusValues,
  assistantMessageRoleLabels,
  assistantMessageRoleValues,
  assistantRecommendationKindLabels,
  assistantRecommendationKindValues,
  assistantRecommendationStateLabels,
  assistantRecommendationStateValues,
  knowledgeEntryTypeLabels,
  knowledgeEntryTypeValues,
  knowledgeSourceLabels,
  knowledgeSourceValues,
};

// Re-export types
export type {
  AssistantActionType,
  AssistantConversationStatus,
  AssistantMessageRole,
  AssistantPrimaryAction,
  AssistantRecommendationKind,
  AssistantRecommendationState,
  KnowledgeEntryType,
  KnowledgeSource,
} from '@borradh-workspace/labels';

// Database enums
export const assistantMessageRoleEnum = pgEnum(
  'assistant_message_role',
  assistantMessageRoleValues
);
export const knowledgeEntryTypeEnum = pgEnum(
  'knowledge_entry_type',
  knowledgeEntryTypeValues
);
export const knowledgeSourceEnum = pgEnum(
  'knowledge_source',
  knowledgeSourceValues
);
export const assistantConversationStatusEnum = pgEnum(
  'assistant_conversation_status',
  assistantConversationStatusValues
);
export const assistantRecommendationKindEnum = pgEnum(
  'assistant_recommendation_kind',
  assistantRecommendationKindValues
);
export const assistantRecommendationStateEnum = pgEnum(
  'assistant_recommendation_state',
  assistantRecommendationStateValues
);

// =============================================================================
// TABLES
// =============================================================================

/**
 * AssistantConversation - Chat sessions with the AI assistant
 */
export const assistantConversation = pgTable(
  'assistant_conversation',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    // Auto-generated from first message or AI summary
    title: text('title'),

    // Escalation state — one-click handoff to Borradh staff.
    // See docs/plans/claire-owner-spec.md §4.5.
    status: assistantConversationStatusEnum('status')
      .notNull()
      .default('active'),
    escalatedAt: timestamp('escalated_at'),
    escalationReason: text('escalation_reason'),

    // Linked Intercom conversation when status === 'escalated'. Set by
    // `requestSupportChat`; webhook lookups go through this column.
    intercomConversationId: text('intercom_conversation_id'),

    // Skill state pinned per-conversation (claire.md §2 Q31b).
    // `loadedSkillIds` is the ordered union of skills loaded into the
    // conversation (intent classifier first turn + `load_skill` tool
    // pivots). The controller treats null/empty as `['default']`.
    // `skillRegistryVersion` freezes the prompt content for the
    // conversation's lifetime; in-flight conversations don't auto-upgrade
    // when the registry changes shape.
    loadedSkillIds: text('loaded_skill_ids').array().notNull().default([]),
    skillRegistryVersion: integer('skill_registry_version')
      .notNull()
      .default(1),

    // Conversation lifecycle — auto-archived after 90 days of inactivity
    // (claire.md §2 Q15/Q7). Null means active.
    archivedAt: timestamp('archived_at'),

    // Channel routing (Claire-on-WhatsApp, WS-4). `web` = in-platform assistant
    // chat (default, unchanged behavior); `whatsapp` = owner texting Claire from
    // their paired personal number. One persistent conversation per
    // (userId, org, channel). `whatsappPhoneE164` records the owner's paired
    // number for whatsapp conversations (null on web). `pendingConfirmation`
    // holds a single in-flight destructive-action gate (e.g. a preview awaiting
    // a "launch" reply); cleared after publish or topic change.
    channel: text('channel')
      .$type<'web' | 'whatsapp'>()
      .notNull()
      .default('web'),
    whatsappPhoneE164: text('whatsapp_phone_e164'),
    pendingConfirmation: jsonb('pending_confirmation').$type<{
      kind: string;
      draftId: string;
    } | null>(),

    // Money-truth interlock (register #137): Meta campaign ids whose daily-budget
    // update FAILED earlier in THIS conversation. A launch for such a campaign is
    // refused (`blocked: unacknowledged_budget_failure`) until the owner
    // explicitly says to go ahead anyway — so Claire can't fail the budget change
    // and then quietly launch the ad at the old, wrong budget. Cleared when the
    // owner acknowledges or when the budget update later succeeds.
    budgetFailureCampaignIds: text('budget_failure_campaign_ids')
      .array()
      .notNull()
      .default([]),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    index('idx_assistant_conversation_org_id').on(table.organizationId),
    index('idx_assistant_conversation_user_id').on(table.userId),
    index('idx_assistant_conversation_status').on(table.status),
  ]
);

/**
 * AssistantWhatsappLink - Verified mapping from an owner's personal WhatsApp
 * number to a platform user + organization (Claire-on-WhatsApp pairing, WS-3/4).
 *
 * Lifecycle: `startWhatsappLink` inserts a `pending` row with a single-use
 * `verificationCode` + `codeExpiresAt` and NO phone yet. The owner sends the
 * code from their personal WhatsApp; `verifyWhatsappLink` matches the inbound
 * code, stamps the sender's E.164 into `phoneE164`, flips `status` to `active`,
 * and sets `verifiedAt`. `resolveOwnerByPhone` looks up the active link by phone
 * on every inbound webhook.
 *
 * Nullable-unique phone: `phoneE164` is null until verification, so it cannot be
 * a NOT NULL column. A plain Postgres UNIQUE constraint treats NULLs as distinct
 * (multiple pending rows with null phone are allowed), while still guaranteeing
 * at most one row per concrete phone number — exactly the semantics we want, so
 * no partial index is needed. The separate `idx_*_phone_e164` index serves the
 * hot webhook lookup path.
 */
export const assistantWhatsappLink = pgTable(
  'assistant_whatsapp_link',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    // Null until the owner verifies; unique once set (NULLs are distinct in PG).
    phoneE164: text('phone_e164').unique(),

    // Single-use pairing code + TTL (set at start, cleared/ignored after verify).
    verificationCode: text('verification_code'),
    codeExpiresAt: timestamp('code_expires_at'),

    status: text('status')
      .$type<'pending' | 'active' | 'revoked'>()
      .notNull()
      .default('pending'),
    verifiedAt: timestamp('verified_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_assistant_whatsapp_link_phone_e164').on(table.phoneE164),
    index('idx_assistant_whatsapp_link_user_id').on(table.userId),
    index('idx_assistant_whatsapp_link_org_id').on(table.organizationId),
  ]
);

/**
 * AssistantMessage - Individual messages in an assistant conversation
 */
export const assistantMessage = pgTable(
  'assistant_message',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => assistantConversation.id, { onDelete: 'cascade' }),

    role: assistantMessageRoleEnum('role').notNull(),
    content: text('content'),

    // AI SDK tool data
    toolCalls: jsonb('tool_calls'),
    toolResults: jsonb('tool_results'),

    // File upload references
    attachments: jsonb('attachments'),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_assistant_message_conversation_id').on(table.conversationId),
  ]
);

/**
 * KnowledgeEntry - Knowledge base entries with vector embeddings for semantic search
 * Requires pgvector extension: CREATE EXTENSION IF NOT EXISTS vector;
 */
export const knowledgeEntry = pgTable(
  'knowledge_entry',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // null = global entry (not org-specific)
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),

    // Per-user knowledge scope (claire.md §2 Q4 — locked).
    // null = org-wide; non-null = personal to that user. The 3 Phase 4
    // populators write `(orgId, userId)` for conversation summaries +
    // `remember`-tool entries, and `(orgId, null)` for nightly operational
    // snapshots. `queryKnowledge` returns the union of org-wide + the
    // requesting user's personal entries when called with `userId`.
    userId: text('user_id').references(() => user.id, {
      onDelete: 'cascade',
    }),

    type: knowledgeEntryTypeEnum('type').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),

    // OpenAI text-embedding-3-small (1536 dimensions)
    embedding: vector('embedding', { dimensions: 1536 }),

    metadata: jsonb('metadata'),
    source: knowledgeSourceEnum('source'),

    // Confidence score (0.0 - 1.0)
    confidence: real('confidence').default(1.0),

    // Optional expiry for time-sensitive knowledge
    expiresAt: timestamp('expires_at'),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_knowledge_entry_org_id').on(table.organizationId),
    index('idx_knowledge_entry_type').on(table.type),
  ]
);

/**
 * AssistantUsage - Daily message count for rate limiting
 */
export const assistantUsage = pgTable(
  'assistant_usage',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    // Date-only column for daily aggregation
    date: date('date').notNull().defaultNow(),

    messageCount: integer('message_count').notNull().default(0),
  },
  (table) => [
    unique('unique_assistant_usage_org_date').on(
      table.organizationId,
      table.date
    ),
    index('idx_assistant_usage_org_id').on(table.organizationId),
  ]
);

/**
 * AssistantRecommendation - "Claire card" rows shown as toast popups above the widget launcher.
 * Rendered by the in-app widget; populated by triggers (cron/event) defined in features/assistant.
 * See docs/plans/claire-owner-spec.md §6 and claire-spec-v2.md Decision 7.
 */
export const assistantRecommendation = pgTable(
  'assistant_recommendation',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    kind: assistantRecommendationKindEnum('kind').notNull(),

    title: text('title').notNull(),
    body: text('body').notNull(),

    // Discriminated union: { label, type: 'navigate'|'tour'|'none', target?, payload? }
    primaryAction: jsonb('primary_action')
      .notNull()
      .$type<AssistantPrimaryAction>(),

    state: assistantRecommendationStateEnum('state')
      .notNull()
      .default('active'),
    priority: integer('priority').notNull().default(0),

    // Trigger-specific context (e.g. conversationId for lead recs, appointmentId for prep recs)
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    actionedAt: timestamp('actioned_at'),
    dismissedAt: timestamp('dismissed_at'),
    expiresAt: timestamp('expires_at'),
  },
  (table) => [
    index('idx_assistant_recommendation_org_id').on(table.organizationId),
    index('idx_assistant_recommendation_state').on(table.state),
    index('idx_assistant_recommendation_kind').on(table.kind),
    index('idx_assistant_recommendation_org_state_kind').on(
      table.organizationId,
      table.state,
      table.kind
    ),
  ]
);

// =============================================================================
// RLS POLICIES
// =============================================================================

// Bucket A: all four tables have organization_id → standard org-isolation policy.
// assistant_message (Bucket B child) is handled by W-GLOBAL.
export const assistantConversationRlsPolicy = orgRlsPolicy(
  assistantConversation
);
export const knowledgeEntryRlsPolicy = orgRlsPolicy(knowledgeEntry);
export const assistantUsageRlsPolicy = orgRlsPolicy(assistantUsage);
export const assistantWhatsappLinkRlsPolicy = orgRlsPolicy(
  assistantWhatsappLink
);
export const assistantRecommendationRlsPolicy = orgRlsPolicy(
  assistantRecommendation
);

// Bucket B1: assistant_message has no organization_id; org scope derives from
// the parent assistant_conversation row via conversation_id FK.
export const assistantMessageRlsPolicy = childOrgRlsPolicy(assistantMessage, {
  parent: 'assistant_conversation',
  fk: 'conversation_id',
});

// =============================================================================
// RELATIONS
// =============================================================================

export const assistantConversationRelations = relations(
  assistantConversation,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [assistantConversation.organizationId],
      references: [organization.id],
    }),
    user: one(user, {
      fields: [assistantConversation.userId],
      references: [user.id],
    }),
    messages: many(assistantMessage),
  })
);

export const assistantMessageRelations = relations(
  assistantMessage,
  ({ one }) => ({
    conversation: one(assistantConversation, {
      fields: [assistantMessage.conversationId],
      references: [assistantConversation.id],
    }),
  })
);

export const knowledgeEntryRelations = relations(knowledgeEntry, ({ one }) => ({
  organization: one(organization, {
    fields: [knowledgeEntry.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [knowledgeEntry.userId],
    references: [user.id],
  }),
}));

export const assistantRecommendationRelations = relations(
  assistantRecommendation,
  ({ one }) => ({
    organization: one(organization, {
      fields: [assistantRecommendation.organizationId],
      references: [organization.id],
    }),
  })
);

export const assistantUsageRelations = relations(assistantUsage, ({ one }) => ({
  organization: one(organization, {
    fields: [assistantUsage.organizationId],
    references: [organization.id],
  }),
}));

export const assistantWhatsappLinkRelations = relations(
  assistantWhatsappLink,
  ({ one }) => ({
    user: one(user, {
      fields: [assistantWhatsappLink.userId],
      references: [user.id],
    }),
    organization: one(organization, {
      fields: [assistantWhatsappLink.organizationId],
      references: [organization.id],
    }),
  })
);

// =============================================================================
// TYPES
// =============================================================================

export type AssistantConversation = typeof assistantConversation.$inferSelect;
export type NewAssistantConversation =
  typeof assistantConversation.$inferInsert;
export type AssistantMessage = typeof assistantMessage.$inferSelect;
export type NewAssistantMessage = typeof assistantMessage.$inferInsert;
export type KnowledgeEntry = typeof knowledgeEntry.$inferSelect;
export type NewKnowledgeEntry = typeof knowledgeEntry.$inferInsert;
export type AssistantUsage = typeof assistantUsage.$inferSelect;
export type NewAssistantUsage = typeof assistantUsage.$inferInsert;
export type AssistantRecommendation =
  typeof assistantRecommendation.$inferSelect;
export type NewAssistantRecommendation =
  typeof assistantRecommendation.$inferInsert;
export type AssistantWhatsappLink = typeof assistantWhatsappLink.$inferSelect;
export type NewAssistantWhatsappLink =
  typeof assistantWhatsappLink.$inferInsert;
