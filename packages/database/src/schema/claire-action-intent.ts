import {
  claireActionIntentTypeLabels,
  claireActionIntentTypeValues,
} from '@borradh-workspace/labels';
import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { assistantConversation } from './assistant.js';
import { organization } from './organization.js';

// =============================================================================
// ENUMS (imported from canonical labels package)
// =============================================================================

export { claireActionIntentTypeLabels, claireActionIntentTypeValues };
export type { ClaireActionIntentType } from '@borradh-workspace/labels';

export const claireActionIntentTypeEnum = pgEnum(
  'claire_action_intent_type',
  claireActionIntentTypeValues
);

// =============================================================================
// TABLES
// =============================================================================

/**
 * ClaireActionIntent — a normalised record of a recent Claire create/launch
 * intent, used for idempotency & duplicate protection (Phase 4).
 *
 * Two jobs:
 *   1. Pre-create dedupe: before `createCampaign` / `createLeadForm` runs, the
 *      similarity check reads recent intents of the same type for the org
 *      inside a short window (~7 days) and compares `normalizedKey` — a
 *      lowercased, punctuation-stripped signature of the proposed action —
 *      so a re-request surfaces the existing candidate instead of spawning a
 *      second campaign/form (#79 #151).
 *   2. Repeated-launch resolution: a bare repeated "launch" resolves to the
 *      in-flight `launch_ad` intent (its `resourceId`) rather than a fresh
 *      build (#95).
 *
 * Rows are cheap and self-expiring in effect — the dedupe query is always
 * time-bounded, so stale rows never match. A cleanup cron can prune rows
 * older than the widest window as a follow-up.
 */
export const claireActionIntent = pgTable(
  'claire_action_intent',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // Scope: org (+ conversation for tracing / repeated-launch resolution).
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    // Nullable: some entry points (background/worker) have no conversation.
    // Cascade delete when the conversation goes away — a stale intent has no
    // meaning without its context.
    conversationId: text('conversation_id').references(
      () => assistantConversation.id,
      { onDelete: 'cascade' }
    ),

    // The kind of action this intent represents.
    action: claireActionIntentTypeEnum('action').notNull(),

    // Normalised signature the dedupe check compares (lowercased, stripped).
    // e.g. a campaign's name + objective, or a lead form's field set.
    normalizedKey: text('normalized_key').notNull(),

    // The resource the intent produced / targets (metaCampaignId, leadFormId,
    // adId). Null while the intent is in-flight and no resource exists yet.
    resourceId: text('resource_id'),

    // A human-readable label for the candidate picker card (e.g. the campaign
    // name). Kept separate from `normalizedKey` so the card shows the original
    // casing/wording, not the normalised form.
    displayName: text('display_name'),

    // Extra structured context (objective, serviceIds, budget) — used both to
    // score similarity and to describe the candidate on the card.
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    // Dedupe scan path: recent intents for (org, action) ordered by time.
    index('idx_claire_action_intent_org_action_created').on(
      table.organizationId,
      table.action,
      table.createdAt
    ),
  ]
);

// =============================================================================
// RLS POLICIES
// =============================================================================

export const claireActionIntentRlsPolicy = orgRlsPolicy(claireActionIntent);

// =============================================================================
// RELATIONS
// =============================================================================

export const claireActionIntentRelations = relations(
  claireActionIntent,
  ({ one }) => ({
    organization: one(organization, {
      fields: [claireActionIntent.organizationId],
      references: [organization.id],
    }),
    conversation: one(assistantConversation, {
      fields: [claireActionIntent.conversationId],
      references: [assistantConversation.id],
    }),
  })
);

// =============================================================================
// TYPES
// =============================================================================

export type ClaireActionIntent = typeof claireActionIntent.$inferSelect;
export type NewClaireActionIntent = typeof claireActionIntent.$inferInsert;
