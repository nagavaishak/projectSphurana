/**
 * Content batches enums - Pure TypeScript (no Drizzle imports)
 * Must stay in sync with schema/content-batch.ts.
 *
 * A "batch" is the monthly bundle of organic content generated for an
 * organisation: 4 graphics + 4 videos. The user reviews each item and
 * either accepts it (will be scheduled) or asks for a regenerate.
 */

// Batch lifecycle. Status values match the draft already in
// list-content-batches.schema.ts so existing API consumers do not break.
//
// planning   -> row created, batch picking templates and seeding items
// generating -> render jobs queued; not all items have an asset URL yet
// review     -> all items rendered; awaiting user accept/regenerate
// scheduling -> user accepted; items being scheduled to socials
// completed  -> every accepted item has a scheduled social post
// failed     -> unrecoverable error during planning/generating; recoverable
//               failures of individual items don't propagate here
export const contentBatchStatusLabels = {
  planning: 'Planning',
  generating: 'Generating',
  review: 'Ready to review',
  scheduling: 'Scheduling',
  completed: 'Completed',
  failed: 'Failed',
} as const;

export const contentBatchStatusValues = Object.keys(
  contentBatchStatusLabels
) as [
  keyof typeof contentBatchStatusLabels,
  ...(keyof typeof contentBatchStatusLabels)[],
];

export type ContentBatchStatus = keyof typeof contentBatchStatusLabels;

// Kind of a single batch item. Mirrors the underlying assets (`video` and
// `graphic` tables). Stored on `content_batch_item.kind` so we can fetch
// items without joining both target tables.
export const contentBatchItemKindLabels = {
  video: 'Video',
  graphic: 'Graphic',
} as const;

export const contentBatchItemKindValues = Object.keys(
  contentBatchItemKindLabels
) as [
  keyof typeof contentBatchItemKindLabels,
  ...(keyof typeof contentBatchItemKindLabels)[],
];

export type ContentBatchItemKind = keyof typeof contentBatchItemKindLabels;

// The DECISION on a slot, and nothing else.
//
// pending   -> waiting on the user (default at insert time)
// accepted  -> user kept this post; will be scheduled when the batch is
//              finalised
// rejected  -> user dropped the post
//
// `regenerated` USED TO LIVE HERE and was removed when the slot was split from
// the attempt. It was never a decision — it meant "a replacement row supersedes
// this one", a lifecycle fact about a row, sitting in an enum every service
// checks to answer "has the user decided yet?". Regenerating now appends a
// `content_batch_attempt` and moves `currentAttemptId`; a superseded cut is
// simply not the current one, which needs no vocabulary at all. A slot stays
// `pending` across a re-roll, which is the truth: the user still has to decide.
export const contentBatchItemReviewStatusLabels = {
  pending: 'Pending review',
  accepted: 'Accepted',
  rejected: 'Rejected',
} as const;

export const contentBatchItemReviewStatusValues = Object.keys(
  contentBatchItemReviewStatusLabels
) as [
  keyof typeof contentBatchItemReviewStatusLabels,
  ...(keyof typeof contentBatchItemReviewStatusLabels)[],
];

export type ContentBatchItemReviewStatus =
  keyof typeof contentBatchItemReviewStatusLabels;

// Who spoke in a batch item's review thread.
//
// The thread is a copy-editing log scoped to ONE item: the user asks for a
// change ("less salesy"), Claire rewrites the caption and replies. It is
// deliberately not an assistant_conversation — there are no tool calls, no
// approvals, and it is thrown away with the batch.
export const contentBatchItemMessageRoleLabels = {
  user: 'You',
  assistant: 'Claire',
} as const;

export const contentBatchItemMessageRoleValues = Object.keys(
  contentBatchItemMessageRoleLabels
) as [
  keyof typeof contentBatchItemMessageRoleLabels,
  ...(keyof typeof contentBatchItemMessageRoleLabels)[],
];

export type ContentBatchItemMessageRole =
  keyof typeof contentBatchItemMessageRoleLabels;

// Which surface produced a content item.
//
// Until now every slot came from the monthly planner, so "content item" and
// "batch post" were the same thing and `batch_id` could be NOT NULL. A
// Claire-chat graphic or a Content Studio one-off is the same shape — one
// decision, one schedule, a thread, and N attempts — with no batch above it.
//
// This is a column rather than an inference from `batch_id IS NULL` because
// the two are not the same question: a standalone item may later be pulled
// into a batch, and "who made this" must survive that.
export const contentItemSourceLabels = {
  monthly_batch: 'Monthly plan',
  claire_chat: 'Claire',
  content_studio: 'Content Studio',
} as const;

export const contentItemSourceValues = Object.keys(contentItemSourceLabels) as [
  keyof typeof contentItemSourceLabels,
  ...(keyof typeof contentItemSourceLabels)[],
];

export type ContentItemSource = keyof typeof contentItemSourceLabels;
