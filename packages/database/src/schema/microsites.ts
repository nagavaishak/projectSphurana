import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { organization } from './organization.js';
import { user } from './user.js';

import { orgRlsPolicy } from '../rls-policy.js';

/**
 * Microsites — the tenant's whole public surface (docs/plans/microsites.md §4).
 *
 * The load-bearing decision: a page is an ORDERED LIST OF TYPED BLOCKS plus a
 * theme, not a per-tenant `.astro` file. The agent mutates a structured
 * document; we render it with our own components. That buys instant edits, a
 * clean undo, and no LLM-authored code served to the public.
 *
 * The jsonb columns are DELIBERATELY UNTYPED here. Their shapes are owned by
 * `@borradh-workspace/web-shared` (`src/microsites/contract.ts`), and this file
 * used to import them for `.$type<T>()`. That inverted the dependency graph:
 * `database` is the lowest layer, `web-shared` is browser-facing, and the API,
 * the worker and the MIGRATION RUNNER all ended up transitively depending on
 * it — so a browser-only import added to `web-shared` would break migrations.
 * It did break CI exactly that way.
 *
 * Nothing real was lost. `.$type<T>()` is a compile-time claim about bytes that
 * arrive from jsonb, which round-trips whatever it is given. The actual
 * guarantee is the Zod schemas in `features/microsites/blocks` plus the
 * drop-and-log sanitising in `features/microsites/services/shared/document.ts`
 * — that is what handles a block written by an older schema version, and it
 * runs whether or not this column carries a type parameter.
 *
 * Read these columns THROUGH those validators. Do not re-add `.$type<>()` here
 * from a higher layer.
 *
 * RLS: every table here is org-scoped via `orgRlsPolicy` (Bucket A — a direct
 * `organization_id` column). `micrositePage`, `micrositeRevision`,
 * `micrositeDomain`, `micrositeConversation` and `micrositeMessage` are all
 * logically scoped through their `micrositeId`, but they DENORMALIZE
 * `organization_id` — exactly the trick `patient_auth` uses. Why: the child
 * policy (`childOrgRlsPolicy`) has to run a correlated EXISTS against the
 * parent on every row, and its unqualified-FK footgun has already shipped a
 * cross-org hole in this codebase once (see rls-policy.ts). A denormalized
 * column makes the predicate a plain equality, and host resolution
 * (`microsite_domain.domain` → org) has to be fast on EVERY public request —
 * it cannot afford a join through `microsite` just to satisfy RLS.
 */

/** Publication state of the microsite as a whole. */
export type MicrositeStatus = 'draft' | 'published';

/** Who produced a revision. `promptId` is only meaningful for `agent`. */
export type MicrositeRevisionAuthor = 'agent' | 'user' | 'system';

/** Custom-domain lifecycle. `removed` is a tombstone — we never reuse the row. */
export type MicrositeDomainStatus =
  | 'pending_dns'
  | 'verifying'
  | 'active'
  | 'error'
  | 'removed';

/** Transcript roles for the editor sidebar. */
export type MicrositeMessageRole = 'user' | 'assistant' | 'system';

/**
 * The DNS challenge we handed the tenant, plus whatever the provider needs to
 * re-check it. Deliberately open-ended — Phase 1 is Vercel domains, §9 plans a
 * move to Cloudflare for SaaS, and the two carry different verification
 * payloads.
 */
export interface MicrositeDomainVerification {
  records?: {
    type: string;
    name: string;
    value: string;
  }[];
  /** Opaque provider handle (Vercel domain id, CF hostname id, …). */
  providerRef?: string;
  [key: string]: unknown;
}

/** One agent tool invocation, as rendered in the sidebar transcript. */
export interface MicrositeToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

/**
 * One microsite per organization — enforced by the unique on
 * `organization_id`, not by convention. Multi-site per tenant is explicitly
 * out of scope for Phase 1; making it possible later means dropping a
 * constraint, whereas allowing it now means every read has to decide which
 * site it meant.
 */
export const microsite = pgTable(
  'microsite',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .unique()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /**
     * Host fallback before a custom domain is live: the wildcard tier
     * `<slug>.borradh.io` and the path tier `www.borradh.io/sites/<slug>`
     * (plan §9). The apex is env-driven (`MICROSITE_BASE_DOMAIN`) so it is
     * configurable per environment — do not hardcode it in a comment again,
     * an earlier draft here said `borradh.site` and disagreed with the plan.
     * Globally unique: it is a hostname component, not an org-scoped name.
     */
    slug: text('slug').notNull().unique(),
    status: text('status').$type<MicrositeStatus>().notNull().default('draft'),
    theme: jsonb('theme').notNull(),
    /**
     * The revision the PUBLIC is served. Publishing = pointing this at a
     * revision; undo = pointing the draft back at N-1.
     *
     * Deliberately NOT a foreign key: `microsite_revision.microsite_id`
     * already references this table, and a FK back would make a cycle that
     * every insert path has to break with a deferred constraint or a two-step
     * write. Referential integrity here is maintained by the publish service,
     * which only ever sets an id it just read from this microsite's own
     * revisions.
     */
    publishedRevisionId: text('published_revision_id'),
    /**
     * The revision the WORKING DRAFT currently corresponds to.
     *
     * The draft itself is the `microsite_page` rows; this is the snapshot they
     * were last written from, or last snapshotted into. Every mutating turn
     * writes a revision AND moves this pointer, which is what makes undo a
     * restore of N-1 rather than a replay, and what makes "N changes since
     * publish" a count of the revisions between `published_revision_id` and
     * this one.
     *
     * NOT a foreign key, for exactly the reason `published_revision_id` is not
     * (see above): `microsite_revision.microsite_id` already references this
     * table, and a FK in this direction would close the cycle. The services
     * that set it only ever write an id they read from this microsite's own
     * revisions, inside the same transaction.
     */
    draftRevisionId: text('draft_revision_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  }
  // No explicit index on `organization_id`: the UNIQUE constraint above already
  // provides one, and one microsite per org means it is the lookup.
);

export const micrositeRlsPolicy = orgRlsPolicy(microsite);

/**
 * The WORKING DRAFT of a page. Published output comes from the revision
 * snapshot, never from here — so an agent mid-edit can never be visible to the
 * public.
 */
export const micrositePage = pgTable(
  'microsite_page',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    micrositeId: text('microsite_id')
      .notNull()
      .references(() => microsite.id, { onDelete: 'cascade' }),
    /** Denormalized from `microsite` so `orgRlsPolicy` applies (see file doc). */
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** Leading-slash path, `/` for the home page. */
    path: text('path').notNull(),
    title: text('title').notNull(),
    seo: jsonb('seo').notNull().default({}),
    blocks: jsonb('blocks').notNull().default([]),
    /** Navigation order. Column is quoted — `order` is a reserved word. */
    order: integer('order').notNull().default(0),
    /** System pages (booking, portal) cannot be deleted by the agent or user. */
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_microsite_page_org_id').on(table.organizationId),
    index('idx_microsite_page_microsite_id').on(table.micrositeId),
    // One page per path per site — the renderer resolves a request by
    // (micrositeId, path) and must never have to pick between two rows.
    unique('uq_microsite_page_site_path').on(table.micrositeId, table.path),
  ]
);

export const micrositePageRlsPolicy = orgRlsPolicy(micrositePage);

/**
 * Immutable snapshot of the whole document — the undo unit AND the publish
 * unit. Every mutating agent turn writes exactly one row. That single decision
 * buys undo, history, "restore this version", and safe publishing.
 *
 * No `updatedAt`: a revision is never edited.
 */
export const micrositeRevision = pgTable(
  'microsite_revision',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    micrositeId: text('microsite_id')
      .notNull()
      .references(() => microsite.id, { onDelete: 'cascade' }),
    /** Denormalized from `microsite` so `orgRlsPolicy` applies (see file doc). */
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** Human label shown in history ("Added the team section"). */
    label: text('label'),
    /** Full page set at the moment of the snapshot — NOT a diff. */
    pages: jsonb('pages').notNull(),
    theme: jsonb('theme').notNull(),
    createdBy: text('created_by').$type<MicrositeRevisionAuthor>().notNull(),
    /** The agent turn that produced it, when `createdBy = 'agent'`. */
    promptId: text('prompt_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_microsite_revision_org_id').on(table.organizationId),
    // History list: newest-first for one site.
    index('idx_microsite_revision_site_created').on(
      table.micrositeId,
      table.createdAt
    ),
  ]
);

export const micrositeRevisionRlsPolicy = orgRlsPolicy(micrositeRevision);

/**
 * Custom domains. `domain` is UNIQUE GLOBALLY — a hostname maps to exactly one
 * tenant, and the unique index is what host resolution reads on EVERY public
 * request. Keep it that way: this is the hottest lookup in the feature.
 */
export const micrositeDomain = pgTable(
  'microsite_domain',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    micrositeId: text('microsite_id')
      .notNull()
      .references(() => microsite.id, { onDelete: 'cascade' }),
    /** Denormalized from `microsite` so `orgRlsPolicy` applies (see file doc). */
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** Lowercased, no scheme, no trailing dot — normalised in the service. */
    domain: text('domain').notNull().unique(),
    /** The apex the tenant's marketing points at; exactly one per site. */
    isPrimary: boolean('is_primary').notNull().default(false),
    status: text('status')
      .$type<MicrositeDomainStatus>()
      .notNull()
      .default('pending_dns'),
    verification: jsonb('verification').$type<MicrositeDomainVerification>(),
    lastCheckedAt: timestamp('last_checked_at'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_microsite_domain_org_id').on(table.organizationId),
    index('idx_microsite_domain_microsite_id').on(table.micrositeId),
    // The unique constraint on `domain` already provides the index host
    // resolution hits per request; this covering index keeps the "which
    // domains are still verifying" sweep off it.
    index('idx_microsite_domain_status').on(table.status),
  ]
);

export const micrositeDomainRlsPolicy = orgRlsPolicy(micrositeDomain);

/** One editor-sidebar thread against a microsite. */
export const micrositeConversation = pgTable(
  'microsite_conversation',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    micrositeId: text('microsite_id')
      .notNull()
      .references(() => microsite.id, { onDelete: 'cascade' }),
    /** Denormalized from `microsite` so `orgRlsPolicy` applies (see file doc). */
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** Staff member who opened the thread; kept if they later leave the org. */
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    title: text('title'),
    lastMessageAt: timestamp('last_message_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_microsite_conversation_org_id').on(table.organizationId),
    index('idx_microsite_conversation_site_last_message').on(
      table.micrositeId,
      table.lastMessageAt
    ),
  ]
);

export const micrositeConversationRlsPolicy = orgRlsPolicy(
  micrositeConversation
);

/**
 * One turn of the transcript. `revisionId` links an assistant turn to the
 * revision it produced, which is what makes "undo this message" a pointer
 * move rather than a replay.
 */
export const micrositeMessage = pgTable(
  'microsite_message',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => micrositeConversation.id, { onDelete: 'cascade' }),
    /** Denormalized from the conversation so `orgRlsPolicy` applies. */
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    role: text('role').$type<MicrositeMessageRole>().notNull(),
    content: text('content').notNull(),
    toolCalls: jsonb('tool_calls').$type<MicrositeToolCall[]>(),
    /**
     * The revision this turn produced, if any. `set null` — deleting an old
     * revision must not erase the transcript that explains it.
     */
    revisionId: text('revision_id').references(() => micrositeRevision.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_microsite_message_org_id').on(table.organizationId),
    index('idx_microsite_message_conversation_created').on(
      table.conversationId,
      table.createdAt
    ),
  ]
);

export const micrositeMessageRlsPolicy = orgRlsPolicy(micrositeMessage);

// =============================================================================
// Relations
// =============================================================================

export const micrositeRelations = relations(microsite, ({ one, many }) => ({
  organization: one(organization, {
    fields: [microsite.organizationId],
    references: [organization.id],
  }),
  pages: many(micrositePage),
  revisions: many(micrositeRevision),
  domains: many(micrositeDomain),
  conversations: many(micrositeConversation),
}));

export const micrositePageRelations = relations(micrositePage, ({ one }) => ({
  microsite: one(microsite, {
    fields: [micrositePage.micrositeId],
    references: [microsite.id],
  }),
  organization: one(organization, {
    fields: [micrositePage.organizationId],
    references: [organization.id],
  }),
}));

export const micrositeRevisionRelations = relations(
  micrositeRevision,
  ({ one, many }) => ({
    microsite: one(microsite, {
      fields: [micrositeRevision.micrositeId],
      references: [microsite.id],
    }),
    organization: one(organization, {
      fields: [micrositeRevision.organizationId],
      references: [organization.id],
    }),
    messages: many(micrositeMessage),
  })
);

export const micrositeDomainRelations = relations(
  micrositeDomain,
  ({ one }) => ({
    microsite: one(microsite, {
      fields: [micrositeDomain.micrositeId],
      references: [microsite.id],
    }),
    organization: one(organization, {
      fields: [micrositeDomain.organizationId],
      references: [organization.id],
    }),
  })
);

export const micrositeConversationRelations = relations(
  micrositeConversation,
  ({ one, many }) => ({
    microsite: one(microsite, {
      fields: [micrositeConversation.micrositeId],
      references: [microsite.id],
    }),
    organization: one(organization, {
      fields: [micrositeConversation.organizationId],
      references: [organization.id],
    }),
    user: one(user, {
      fields: [micrositeConversation.userId],
      references: [user.id],
    }),
    messages: many(micrositeMessage),
  })
);

export const micrositeMessageRelations = relations(
  micrositeMessage,
  ({ one }) => ({
    conversation: one(micrositeConversation, {
      fields: [micrositeMessage.conversationId],
      references: [micrositeConversation.id],
    }),
    organization: one(organization, {
      fields: [micrositeMessage.organizationId],
      references: [organization.id],
    }),
    revision: one(micrositeRevision, {
      fields: [micrositeMessage.revisionId],
      references: [micrositeRevision.id],
    }),
  })
);

// =============================================================================
// Types
// =============================================================================

export type Microsite = typeof microsite.$inferSelect;
export type NewMicrosite = typeof microsite.$inferInsert;
export type MicrositePageRow = typeof micrositePage.$inferSelect;
export type NewMicrositePageRow = typeof micrositePage.$inferInsert;
export type MicrositeRevision = typeof micrositeRevision.$inferSelect;
export type NewMicrositeRevision = typeof micrositeRevision.$inferInsert;
export type MicrositeDomain = typeof micrositeDomain.$inferSelect;
export type NewMicrositeDomain = typeof micrositeDomain.$inferInsert;
export type MicrositeConversation = typeof micrositeConversation.$inferSelect;
export type NewMicrositeConversation =
  typeof micrositeConversation.$inferInsert;
export type MicrositeMessage = typeof micrositeMessage.$inferSelect;
export type NewMicrositeMessage = typeof micrositeMessage.$inferInsert;
