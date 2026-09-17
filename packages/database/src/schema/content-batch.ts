import { relations } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { graphic } from './graphic.js';
import { organization } from './organization.js';
import { video } from './video.js';

import {
  contentBatchItemKindLabels,
  contentBatchItemKindValues,
  contentBatchItemMessageRoleLabels,
  contentBatchItemMessageRoleValues,
  contentBatchItemReviewStatusLabels,
  contentBatchItemReviewStatusValues,
  contentBatchStatusLabels,
  contentBatchStatusValues,
  contentItemSourceLabels,
  contentItemSourceValues,
} from '@borradh-workspace/labels';

export {
  contentBatchStatusLabels,
  contentBatchStatusValues,
  contentBatchItemKindLabels,
  contentBatchItemKindValues,
  contentBatchItemReviewStatusLabels,
  contentBatchItemReviewStatusValues,
  contentBatchItemMessageRoleLabels,
  contentBatchItemMessageRoleValues,
  contentItemSourceLabels,
  contentItemSourceValues,
};
export type {
  ContentBatchStatus,
  ContentBatchItemKind,
  ContentBatchItemReviewStatus,
  ContentBatchItemMessageRole,
  ContentItemSource,
} from '@borradh-workspace/labels';

export const contentBatchStatusEnum = pgEnum(
  'content_batch_status',
  contentBatchStatusValues
);

export const contentBatchItemKindEnum = pgEnum(
  'content_batch_item_kind',
  contentBatchItemKindValues
);

export const contentBatchItemReviewStatusEnum = pgEnum(
  'content_batch_item_review_status',
  contentBatchItemReviewStatusValues
);

export const contentBatchItemMessageRoleEnum = pgEnum(
  'content_batch_item_message_role',
  contentBatchItemMessageRoleValues
);

export const contentItemSourceEnum = pgEnum(
  'content_item_source',
  contentItemSourceValues
);

/**
 * Per-slot narrative blob produced by the organic content planner. One LLM
 * call generates this and both the on-screen video copy and the long-form
 * caption are derived from it, so the video and the post text tell one
 * coherent story.
 */
export interface VideoIdea {
  topic: string;
  angle: string;
  payoff: string;
  audience: string;
  serviceName: string;
}

/**
 * A named clip edit staged from the review thread.
 *
 * Structurally the `ClipOperation` union from
 * `packages/features/src/videos/video-capabilities.ts`, restated here because
 * the schema layer cannot import from features.
 *
 * `swap` and `remove` are the operations a MODEL may stage: both are
 * contractually guaranteed to leave untouched clips alone, which is what makes
 * them safe for a caller holding a partial view of the list. Claire always is
 * one.
 *
 * `replace-all` is the exception, and the exception is the clip list editor.
 * The card renders the stored list and hands back the same list reordered,
 * added to or shortened — the owner edited every position they can see because
 * they can see every position. There is nothing for it to silently drop. It is
 * also the only operation that can express a REORDER at all, which is the
 * single thing the card exists for that named edits cannot say.
 *
 * The guard is on who may write it, not on whether it exists: it is absent from
 * the wire contract Claire's `patchDraftVideo` validates against, so a model
 * still cannot produce a whole clip list.
 */
export type PendingClipOperation =
  | { op: 'swap'; index: number; assetId: string }
  | { op: 'remove'; index: number }
  | { op: 'replace-all'; assetIds: string[] };

/**
 * Video edits staged from the review thread, awaiting one commit.
 *
 * `patch` is a partial `VideoDraftConfig` narrowed at write time to the active
 * organic template's own config key (on-screen copy), never the clip list or
 * the talking head.
 */
export interface PendingVideoEdits {
  clipOperations: PendingClipOperation[];
  patch: Record<string, unknown>;
}

/**
 * content_batch
 *
 * One row per (organization, month). The monthly cron picks templates,
 * inserts 4 graphic items + 4 video items, queues renders, and waits.
 * Each org has at most one batch per month — enforced by a unique index on
 * `periodMonth` is a LABEL of when the batch was generated, not a key. It used
 * to be uniquely constrained per org, which bounded batches to one per calendar
 * month — wrong for how they are actually created (people click "generate"
 * whenever, not on the 1st) and the cause of two visible bugs: a batch made on
 * the 28th crammed its posts into the last two days, and the next calendar
 * month immediately permitted another. Coverage is now measured from the
 * generation date instead.
 */
export const contentBatch = pgTable(
  'content_batch',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    // Month this batch is for, formatted YYYY-MM (e.g. "2026-05"). Stored
    // as text rather than a date so callers can address batches by
    // calendar month without timezone ambiguity.
    periodMonth: text('period_month').notNull(),

    status: contentBatchStatusEnum('status').notNull().default('planning'),

    // Optional error message when status = 'failed'.
    errorMessage: text('error_message'),

    // When the batch should be auto-finalised (e.g. accept-all on remaining
    // pending items) if the user never reviews it. Cron checks this column
    // to decide which batches to finalise automatically.
    finaliseAt: timestamp('finalise_at'),

    // When the user finished reviewing (or it was auto-finalised). Used to
    // transition the batch to 'scheduling' and is the field the Socials
    // page reads to know whether to surface the review modal.
    reviewedAt: timestamp('reviewed_at'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_content_batch_org_id').on(table.organizationId),
    // "Current batch" is the most recently created one, not the one matching
    // this calendar month — batches are created on demand, whenever the owner
    // clicks generate.
    index('idx_content_batch_org_created').on(
      table.organizationId,
      table.createdAt
    ),
  ]
);

/**
 * content_item — a SLOT of content.
 *
 * One row per post in the month's plan: "post 3". It owns the things that are
 * true of the post regardless of which cut is currently in it — the decision,
 * the schedule, the pages, the idea, the regeneration budget, and (via
 * `content_item_message`) the conversation.
 *
 * The asset itself lives in `content_attempt`, and `currentAttemptId`
 * says which one is live.
 *
 * WHY THE SPLIT. This row used to be BOTH the slot and the attempt: a
 * regenerate inserted a whole new item row carrying `previousItemId`, flipped
 * the original to `reviewStatus = 'regenerated'`, and every reader had to
 * reconstruct "the current item for this position" by walking that linked list.
 * Four frontend files hand-copied the walk; the schema and the frontend encoded
 * "current" by two DIFFERENT rules that agreed only because the regenerate
 * service happened to satisfy both. Everything downstream inherited it: the
 * review thread hung off the attempt, so regenerating a post silently orphaned
 * its conversation; the previous cut still existed but nothing could address
 * it, so undo was designed and never built; and the re-roll tally counted on
 * the replacement row rather than the slot.
 *
 * A slot is a thing. It is now a row, not a query.
 */
export const contentItem = pgTable(
  'content_item',
  {
    id: text('id').primaryKey(),

    // Ownership, denormalised off the batch.
    //
    // Org scope used to derive from `content_batch` through `batch_id`, which
    // stops working the moment `batch_id` can be null: the RLS policy is a
    // correlated EXISTS against the parent, so a null FK makes the row both
    // invisible AND unwritable (the same predicate is the WITH CHECK). That
    // would not fail in review either — RLS sits behind `RLS_ENABLED` — it
    // would fail on the flip. See `contentItemRlsPolicy` below.
    //
    // It is also the honest shape: the org owns the content, not the grouping
    // that happens to contain it.
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    // NULL = a standalone item (Claire chat, Content Studio). Non-null = part
    // of a monthly plan. A batch is now one PRODUCER of items rather than the
    // only way an item can exist.
    batchId: text('batch_id').references(() => contentBatch.id, {
      onDelete: 'cascade',
    }),

    // Which surface produced this. Not inferred from `batch_id IS NULL`: a
    // standalone item may later be pulled into a batch, and "who made this"
    // has to survive that.
    source: contentItemSourceEnum('source').notNull().default('monthly_batch'),

    kind: contentBatchItemKindEnum('kind').notNull(),

    // The cut currently in this slot. Nullable ONLY between inserting the slot
    // and its first attempt, inside the same transaction — every read path may
    // assume it is set. Not an FK column constraint: slot and attempt reference
    // each other, and a circular NOT NULL FK pair cannot be inserted without
    // deferred constraints. The attempt's `slotId` is the enforced direction.
    currentAttemptId: text('current_attempt_id'),

    // The DECISION on this post, and nothing else. `regenerated` is gone from
    // this vocabulary: it was a lifecycle marker smuggled into a decision enum,
    // and "superseded" is now simply "not the current attempt".
    reviewStatus: contentBatchItemReviewStatusEnum('review_status')
      .notNull()
      .default('pending'),

    // 0-indexed position within the batch (0-3 for graphics, 0-3 for
    // videos). Mobile swipe order keys off this. Stable for the life of the
    // slot — regenerating no longer mints a row that has to reuse it.
    //
    // NULL for a standalone item: position only means something relative to
    // the other posts in a plan. Deliberately NOT defaulted to 0, which would
    // pile every standalone item onto the same rung and read as a real
    // ordering. Readers that sort must treat null as unordered.
    position: integer('position'),

    // How many times this slot has been re-rolled. Equal to
    // `count(attempts) - 1`, denormalised so a read never has to aggregate.
    //
    // A SPEND METER, not a budget: it is surfaced in the review UI so the cost
    // stays visible, but nothing refuses on it. Undo does NOT decrement it —
    // those renders were really paid for, and giving them back would make the
    // meter understate what the batch cost.
    regenerationCount: integer('regeneration_count').notNull().default(0),

    // If the user accepts and the item is scheduled to socials, the
    // resulting social_post.id is stored here for traceability.
    scheduledSocialPostId: text('scheduled_social_post_id'),

    // When the resulting social_post should publish. UTC. Set by the
    // planner, editable in the review dialog, copied into social_post on
    // accept.
    scheduledAt: timestamp('scheduled_at'),

    // Meta page IDs (meta_ads_page.id[]) to cross-post this slot to.
    // Defaults at plan time to every connected page, editable in the review
    // dialog.
    targetPageIds: jsonb('target_page_ids').$type<string[]>(),

    // VideoIdea the slot's content was derived from. Slot-level: the idea is
    // what the post is ABOUT, and it survives a re-roll of how it is told.
    videoIdea: jsonb('video_idea').$type<VideoIdea>(),

    // A re-roll the owner has asked for in the thread but NOT yet confirmed:
    // the instruction(s) the regenerate will be given.
    //
    // Held rather than fired, because a re-roll costs a render and replaces the
    // cut on screen — that is the owner's call, not a side effect of describing
    // what they want. Persisted for the same reason the attempt's staged edits
    // are: the thread survives a refresh, so a button the thread's own text
    // points at must survive with it. Slot-level, because it outlives the cut
    // it was asked about.
    //
    // A LIST, not a note-plus-slide pair. The carousel refiner already runs one
    // model call per slide (`graphic-generate-processor`, mapLimit over the
    // prior outputs), so "slide 1 says A, slide 2 says B" is one job at the
    // same cost as refining the whole deck — the only thing that was ever
    // shared was a single instruction string. Shape:
    //
    //   [{ slideIndex: null, note }]        whole asset: a video, a single
    //                                       graphic, or every slide of a deck
    //   [{ slideIndex: 1, note }]           one slide; the others are preserved
    //   [{ slideIndex: 0, … }, { 1, … }]    a different instruction per slide
    //
    // `slideIndex: null` never mixes with indexed entries — "make them all
    // warmer AND slide 2 says X" has no defined precedence, so the service
    // rejects it rather than guessing.
    //
    // Each note is capped at 280 in the service to match
    // `regenerateBatchItemSchema.reason`, where it is ultimately spent.
    //
    // Left UNTYPED, exactly as `pendingVideoEdits` is and for the same reason:
    // the response-contract generator emits `z.unknown()` for every jsonb
    // column, so a `$type<>()` here would put the row type and its generated
    // atom permanently out of step and fail the app's typecheck. Readers narrow
    // with a parse rather than a cast — the right call for a column that model
    // output lands in.
    pendingRegenerate: jsonb('pending_regenerate'),

    // When the user accepted or rejected.
    decidedAt: timestamp('decided_at'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_content_item_batch_id').on(table.batchId),
    index('idx_content_item_batch_kind_position').on(
      table.batchId,
      table.kind,
      table.position
    ),
    index('idx_content_item_current_attempt').on(table.currentAttemptId),
  ]
);

/**
 * content_batch_attempt — ONE CUT at filling a slot.
 *
 * The asset and the copy that goes with it. A regenerate appends one of these
 * and moves `content_batch_item.currentAttemptId`; it does not touch the slot's
 * decision, schedule, pages or conversation, because none of those are about
 * the cut.
 *
 * Nothing is ever destroyed. Superseded attempts keep their `videoId` /
 * `graphicId`, so the rendered blob is still there and going back to a previous
 * cut is a pointer write — no render, no wait. That is what makes undo cheap,
 * and it is the whole reason this table exists rather than a mutated column.
 *
 * `videoId` xor `graphicId` is set (enforced in service code — Postgres CHECK
 * constraints get clobbered by drizzle-kit, so the invariant stays out of the
 * schema, as it did on the item row before).
 *
 * `organizationId` carries org scope directly (Bucket A). `batchId` is still
 * denormalised — derivable via `slotId` — but now only so a batch-scoped read
 * stays one hop; it no longer has anything to do with RLS, and it is nullable
 * for a standalone slot.
 */
export const contentAttempt = pgTable(
  'content_attempt',
  {
    id: text('id').primaryKey(),

    // Ownership, denormalised. Same reason as on the item: `batch_id` is now
    // nullable, so it can no longer carry org scope.
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    slotId: text('slot_id')
      .notNull()
      .references(() => contentItem.id, { onDelete: 'cascade' }),

    // NULL when the slot is standalone. Kept (rather than dropped in favour of
    // reaching through `slotId`) so a batch-scoped read stays one hop.
    batchId: text('batch_id').references(() => contentBatch.id, {
      onDelete: 'cascade',
    }),

    // 0-based. Attempt 0 is what the planner generated; the rest are re-rolls.
    // Unique per slot, so two concurrent presses cannot both claim a number and
    // mangle the history.
    attemptNumber: integer('attempt_number').notNull(),

    videoId: text('video_id').references(() => video.id, {
      onDelete: 'set null',
    }),
    graphicId: text('graphic_id').references(() => graphic.id, {
      onDelete: 'set null',
    }),

    // Long-form post text for THIS cut. Per-attempt, not per-slot: a re-roll
    // rewrites the words to match the new footage, and going back to a previous
    // cut has to bring that cut's caption with it or the post stops making
    // sense. Copied into the social_post on accept.
    caption: text('caption'),

    // Clip/text edits the owner staged in the thread against THIS cut, held
    // until they commit. Persisted rather than client-side because "remove clip
    // 1, change clip 2" is staged over several turns, and losing it on a
    // refresh — after Claire said it was staged — is worse than not batching.
    // Cleared when applied.
    //
    // Left UNTYPED on purpose. The response-contract generator emits
    // `z.unknown()` for every jsonb column, so a `$type<PendingVideoEdits>()`
    // would put the row type and its generated atom out of step and fail the
    // app's typecheck. Readers narrow with `parsePendingVideoEdits`, which
    // validates rather than asserts — the right call for a column that model
    // output lands in.
    pendingVideoEdits: jsonb('pending_video_edits'),

    // How many re-renders this cut's staged edits have cost. Deliberately NOT
    // capped: `regenerationCount` bounds AI re-rolls, and a considered clip
    // change is not indecision. This exists so the cost stays visible.
    editRenderCount: integer('edit_render_count').notNull().default(0),

    // Why this cut was asked for — the refinement note handed to the re-roll.
    // Null on attempt 0, which nobody asked for.
    regenerationReason: text('regeneration_reason'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    // The history read: every cut for one slot, oldest first. Also the
    // uniqueness that keeps attempt numbering honest under concurrent presses.
    uniqueIndex('idx_content_attempt_slot_number').on(
      table.slotId,
      table.attemptNumber
    ),
    index('idx_content_attempt_batch_id').on(table.batchId),
  ]
);

/**
 * content_item_message
 *
 * The review thread for ONE SLOT: the user's instruction ("less salesy") and
 * Claire's reply, in order. Rewriting copy during review is a conversation, not
 * a form, and the thread is what makes "every instruction and every version in
 * one place per post" true.
 *
 * Scoped per slot on purpose — a single thread spanning the whole batch would
 * let post 3's rewrite see post 1's copy and cross-contaminate. Instructions
 * that SHOULD outlive the batch are promoted to a `knowledge_entry` preference
 * instead; nothing here is meant to survive it.
 *
 * `itemId` points at the SLOT, which is why the conversation now survives a
 * regenerate. It used to point at what was simultaneously the attempt, so
 * re-rolling a post left its entire thread stranded on a row the UI no longer
 * showed — you asked for a change, watched it happen, and the record of asking
 * disappeared.
 *
 * `organizationId` carries org scope directly (Bucket A). `batchId` is still
 * denormalised — derivable via `itemId` — but now only to keep a batch-scoped
 * read one hop, and it is nullable for a standalone slot.
 *
 * `captionSnapshot` holds the caption as it stood AFTER the turn, which gives
 * version history and revert without a second table. Null on user turns and on
 * any assistant turn that answered without changing the copy.
 */
export const contentItemMessage = pgTable(
  'content_item_message',
  {
    id: text('id').primaryKey(),

    // Ownership, denormalised — see the item and attempt rows above.
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    // NULL when the slot is standalone.
    batchId: text('batch_id').references(() => contentBatch.id, {
      onDelete: 'cascade',
    }),

    itemId: text('item_id')
      .notNull()
      .references(() => contentItem.id, { onDelete: 'cascade' }),

    role: contentBatchItemMessageRoleEnum('role').notNull(),

    content: text('content').notNull(),

    captionSnapshot: text('caption_snapshot'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    // The thread read: every message for one item, oldest first.
    index('idx_content_item_message_item_created').on(
      table.itemId,
      table.createdAt
    ),
    index('idx_content_item_message_batch_id').on(table.batchId),
  ]
);

export const contentBatchRlsPolicy = orgRlsPolicy(contentBatch);

// Bucket A, all three. These were Bucket B1 (`childOrgRlsPolicy` through
// `content_batch` via `batch_id`) right up until `batch_id` became nullable.
//
// That combination is a silent, total failure: the child policy is a correlated
// `EXISTS (SELECT 1 FROM content_batch p WHERE p.id = <child>.batch_id AND …)`,
// which for a NULL `batch_id` evaluates FALSE. The same predicate is the
// `WITH CHECK`, so every standalone item would be simultaneously unreadable and
// uninsertable — and because RLS sits behind `RLS_ENABLED` (pinned off in prod,
// #506), it would pass review and detonate on the flip, not before.
//
// Denormalising `organization_id` is what makes these Bucket A, and it is also
// simply the truthful shape: the org owns the content, not the grouping that
// happens to contain it.
export const contentItemRlsPolicy = orgRlsPolicy(contentItem);

export const contentItemMessageRlsPolicy = orgRlsPolicy(contentItemMessage);

export const contentAttemptRlsPolicy = orgRlsPolicy(contentAttempt);

export const contentBatchRelations = relations(
  contentBatch,
  ({ many, one }) => ({
    organization: one(organization, {
      fields: [contentBatch.organizationId],
      references: [organization.id],
    }),
    items: many(contentItem),
  })
);

export const contentItemRelations = relations(contentItem, ({ many, one }) => ({
  batch: one(contentBatch, {
    fields: [contentItem.batchId],
    references: [contentBatch.id],
  }),
  // Every cut ever made for this slot, oldest first when ordered by
  // `attemptNumber`. Undo reads the one before `currentAttempt`.
  attempts: many(contentAttempt, { relationName: 'slotAttempts' }),
  // The live cut. A separate `one(...)` rather than a filter over `attempts`
  // so the common read — "the batch, with what is on screen for each post" —
  // is a plain join and cannot accidentally pick a superseded row.
  currentAttempt: one(contentAttempt, {
    fields: [contentItem.currentAttemptId],
    references: [contentAttempt.id],
    relationName: 'currentAttempt',
  }),
  messages: many(contentItemMessage),
  organization: one(organization, {
    fields: [contentItem.organizationId],
    references: [organization.id],
  }),
}));

export const contentAttemptRelations = relations(contentAttempt, ({ one }) => ({
  slot: one(contentItem, {
    fields: [contentAttempt.slotId],
    references: [contentItem.id],
    relationName: 'slotAttempts',
  }),
  batch: one(contentBatch, {
    fields: [contentAttempt.batchId],
    references: [contentBatch.id],
  }),
  video: one(video, {
    fields: [contentAttempt.videoId],
    references: [video.id],
  }),
  graphic: one(graphic, {
    fields: [contentAttempt.graphicId],
    references: [graphic.id],
  }),
}));

export const contentItemMessageRelations = relations(
  contentItemMessage,
  ({ one }) => ({
    item: one(contentItem, {
      fields: [contentItemMessage.itemId],
      references: [contentItem.id],
    }),
    batch: one(contentBatch, {
      fields: [contentItemMessage.batchId],
      references: [contentBatch.id],
    }),
  })
);

export type ContentBatch = typeof contentBatch.$inferSelect;
export type NewContentBatch = typeof contentBatch.$inferInsert;
export type ContentItem = typeof contentItem.$inferSelect;
export type NewContentItem = typeof contentItem.$inferInsert;
export type ContentAttempt = typeof contentAttempt.$inferSelect;
export type NewContentAttempt = typeof contentAttempt.$inferInsert;
export type ContentItemMessage = typeof contentItemMessage.$inferSelect;
export type NewContentItemMessage = typeof contentItemMessage.$inferInsert;
