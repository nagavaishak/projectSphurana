import {
  claireConfirmationActionLabels,
  claireConfirmationActionValues,
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

// Re-export labels and values for consumers
export { claireConfirmationActionLabels, claireConfirmationActionValues };

// Re-export type
export type { ClaireConfirmationAction } from '@borradh-workspace/labels';

export const claireConfirmationActionEnum = pgEnum(
  'claire_confirmation_action',
  claireConfirmationActionValues
);

// =============================================================================
// TABLES
// =============================================================================

/**
 * ClaireConfirmationToken — single-use token issued by the Claire tool factory
 * when the model proposes a destructive action. The token is returned to the
 * model + UI; the next tool call must echo it back to actually execute.
 *
 * See docs/implementations/claire.md §2 (Backend / Confirmation tokens) and
 * `claire-briefs/track-c02.md` §Step 7 for the wire shape.
 *
 * TTL: 30 minutes by default (configurable). A cleanup cron is a follow-up
 * (TODO post-C-02): periodically delete rows where
 * `consumedAt IS NOT NULL OR expiresAt < now()`.
 */
export const claireConfirmationToken = pgTable(
  'claire_confirmation_token',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // Scope: org + conversation. Cascade when either is deleted — pending
    // tokens have no meaning outside their conversation context.
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => assistantConversation.id, { onDelete: 'cascade' }),

    // What the operator is being asked to confirm.
    action: claireConfirmationActionEnum('action').notNull(),

    // The thing being acted on (adId, appointmentId, offerId, etc.). Free-form
    // because the resource type varies per action.
    resourceId: text('resource_id').notNull(),

    // Action-specific input the model proposed (e.g. new budget, new slot).
    // Stored so the second-call execute can validate the model didn't change
    // its mind between confirmation and execution.
    payload: jsonb('payload').$type<Record<string, unknown>>(),

    // Single-use marker. Set when the second tool call validates and executes.
    consumedAt: timestamp('consumed_at'),

    // Turn-boundary binding (Phase 6, finding #131). The id of the latest
    // PERSISTED user message in the conversation at token-creation time
    // (messages persist at end-of-turn, so this is the user turn BEFORE the
    // one that produced the proposal card; null for a conversation's first
    // turn). Verification refuses to consume a token unless a NEWER user
    // message exists — i.e. the operator sent a message AFTER the proposal
    // was shown. Chat approval is the approval; there is no approve button.
    createdInMessageId: text('created_in_message_id'),

    // Stamped on consumption with the id of the newest persisted user
    // message post-dating token creation — the on-record proof that an
    // intervening user turn approved the action. (With end-of-turn
    // persistence the literal approving message is persisted at the end of
    // the approving turn; this id is the latest user turn on record at the
    // moment of execution.)
    approvedInMessageId: text('approved_in_message_id'),

    // Hard expiry. Tokens past `expiresAt` are rejected by the factory.
    expiresAt: timestamp('expires_at').notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    // Fast lookup of pending tokens for a given conversation (factory's
    // common path: "is there a token matching (org, conversation, action,
    // resource)?").
    index('idx_claire_confirmation_token_org_conversation').on(
      table.organizationId,
      table.conversationId
    ),
    // Cleanup-cron scan path.
    index('idx_claire_confirmation_token_expires_at').on(table.expiresAt),
  ]
);

// =============================================================================
// RLS POLICIES
// =============================================================================

export const claireConfirmationTokenRlsPolicy = orgRlsPolicy(
  claireConfirmationToken
);

// =============================================================================
// RELATIONS
// =============================================================================

export const claireConfirmationTokenRelations = relations(
  claireConfirmationToken,
  ({ one }) => ({
    organization: one(organization, {
      fields: [claireConfirmationToken.organizationId],
      references: [organization.id],
    }),
    conversation: one(assistantConversation, {
      fields: [claireConfirmationToken.conversationId],
      references: [assistantConversation.id],
    }),
  })
);

// =============================================================================
// TYPES
// =============================================================================

export type ClaireConfirmationToken =
  typeof claireConfirmationToken.$inferSelect;
export type NewClaireConfirmationToken =
  typeof claireConfirmationToken.$inferInsert;
