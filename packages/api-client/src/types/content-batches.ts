/**
 * @borradh-workspace/api-client — Content Batches API types.
 *
 * Mirror of the backend `content-batches` feature. Types are derived from
 * the database / features-shared layer using `Serialize<T>` so dates land
 * as ISO strings on the wire.
 */

import type {
  ContentBatch as BackendContentBatch,
  ContentItem as BackendContentItem,
  Graphic as BackendGraphic,
  Video as BackendVideo,
  ContentBatchItemKind,
  ContentBatchItemMessageRole,
  ContentBatchItemReviewStatus,
  ContentBatchStatus,
} from '@borradh-workspace/features/shared';

import {
  contentBatchItemKindLabels,
  contentBatchItemKindValues,
  contentBatchItemMessageRoleLabels,
  contentBatchItemMessageRoleValues,
  contentBatchItemReviewStatusLabels,
  contentBatchItemReviewStatusValues,
  contentBatchStatusLabels,
  contentBatchStatusValues,
  graphicUsageTypeLabels,
  graphicUsageTypeValues,
  videoUsageTypeLabels,
  videoUsageTypeValues,
} from '@borradh-workspace/features/shared';

import type { Serialize } from './serialization.js';
import type { PaginationParams } from './shared.js';

// ============================================================================
// ENUM TYPES + LABELS
// ============================================================================

export type {
  ContentBatchStatus,
  ContentBatchItemKind,
  ContentBatchItemReviewStatus,
  ContentBatchItemMessageRole,
};

export {
  contentBatchStatusLabels,
  contentBatchStatusValues,
  contentBatchItemKindLabels,
  contentBatchItemKindValues,
  contentBatchItemMessageRoleLabels,
  contentBatchItemMessageRoleValues,
  contentBatchItemReviewStatusLabels,
  contentBatchItemReviewStatusValues,
  graphicUsageTypeLabels,
  graphicUsageTypeValues,
  videoUsageTypeLabels,
  videoUsageTypeValues,
};

// ============================================================================
// ENTITY TYPES (serialized — Date → string for the wire)
// ============================================================================

export type ContentBatch = Serialize<BackendContentBatch>;
export type ContentItem = Serialize<BackendContentItem>;
export type ContentBatchVideo = Serialize<BackendVideo>;
export type ContentBatchGraphic = Serialize<BackendGraphic>;

/**
 * A post as the review UI sees it: the SLOT, flattened with the CUT currently
 * in it. Either `video` or `graphic` is set depending on `kind`; the UI keys
 * off `kind` for which card to render.
 *
 * The attempt's fields are lifted rather than nested so callers keep reading
 * `item.caption` and `item.video` unchanged across the slot/attempt split.
 *
 * What is gone is `previousItemId`. There is exactly one row per post here now
 * — the server resolves which cut is current — so there is nothing to filter
 * and no supersession chain to walk. Four components used to do that walk by
 * hand, each with its own copy.
 */
export interface ContentItemWithAsset extends ContentItem {
  video: ContentBatchVideo | null;
  graphic: ContentBatchGraphic | null;
  /** The live cut, and its place in this post's history. */
  attemptId: string;
  attemptNumber: number;
  /** Copy for this cut. */
  caption: string | null;
  pendingVideoEdits: unknown;
  editRenderCount: number;
  regenerationReason: string | null;
  /**
   * Whether an earlier cut exists to go back to — the server's answer, so
   * "can I undo" has one definition. Not the same as "under the cap": after an
   * undo you are on cut 1 with two spent and nothing further back.
   */
  canUndoRegenerate: boolean;
  /**
   * A re-roll Claire PROPOSED on this post that nobody has confirmed yet.
   *
   * Narrowed here rather than on the column: `pending_regenerate` is jsonb, and
   * the contract generator emits `z.unknown()` for jsonb, so typing the column
   * would put the row type and its generated atom permanently out of step.
   */
  pendingRegenerate: PendingRegenerateEdit[] | null;
}

// ============================================================================
// RESPONSE SHAPES
// ============================================================================

export interface GetBatchResponse {
  batch: ContentBatch;
  items: ContentItemWithAsset[];
}

export interface ListContentBatchesResponse {
  items: ContentBatch[];
  limit: number;
  offset: number;
}

/**
 * One turn of a post's review thread.
 *
 * `captionSnapshot` is the caption as it stood AFTER this turn — set on
 * assistant turns that changed the copy, null on user turns and on replies
 * that answered without editing. It backs "revert to this version".
 */
export interface ContentItemMessage {
  id: string;
  role: ContentBatchItemMessageRole;
  content: string;
  captionSnapshot: string | null;
  createdAt: string;
}

export interface ListBatchItemMessagesResponse {
  messages: ContentItemMessage[];
}

/**
 * A rule Claire proposes promoting to a standing preference — present only
 * when the instruction generalises beyond this post. The UI offers it as a
 * chip; nothing is saved until the user taps it.
 */
export interface SuggestedContentRule {
  title: string;
  content: string;
}

/** A clip edit the thread has staged but not yet committed. */
export interface StagedClipEdit {
  op: 'swap' | 'remove';
  /** 1-based, matching how the owner and the thread refer to it. */
  clipNumber: number;
  assetId?: string;
}

export interface StagedVideoEdits {
  clips: StagedClipEdit[];
  textChanges: string[];
}

export interface ReviewTurnResponse {
  /** The revised caption, already persisted on the item. */
  caption: string;
  /** The whole thread, including the two turns this call appended. */
  messages: ContentItemMessage[];
  suggestedRule: SuggestedContentRule | null;
  /**
   * Video edits waiting on a commit, or null when the turn changed nothing
   * about the video. Applying them is separate — every commit is a re-render.
   */
  stagedEdits: StagedVideoEdits | null;
  /** Re-renders this post's edits have cost. Visible, deliberately not capped. */
  renderCount: number;
  /**
   * A re-roll Claire PROPOSED and the owner hasn't confirmed, or null.
   *
   * `slideIndex: null` means the whole asset; numbered entries target carousel
   * slides and preserve the rest. Several entries = a different instruction per
   * slide, which the renderer does in ONE pass.
   */
  pendingRegenerate: PendingRegenerateEdit[] | null;
}

/** One instruction in a proposed re-roll. */
export interface PendingRegenerateEdit {
  /** 0-based carousel slide, or null for the whole asset. */
  slideIndex: number | null;
  /** `refine` re-renders that slide; `remove` drops it from the deck. */
  op: 'refine' | 'remove';
  /** What to change. Absent for a removal — there is nothing to instruct. */
  note?: string;
}

/** One clip of a video post, as the clip list editor shows it. */
export interface BatchItemClip {
  assetId: string;
  name: string;
  thumbnailUrl: string | null;
  /** The clip itself, for full-screen playback. Null while transcoding. */
  blobUrl: string | null;
  /** Seconds, or null when the asset never reported one. */
  duration: number | null;
  clipNumber: number;
  /** Set when a staged edit targets this clip. `added` = new in the staged list. */
  staged: 'remove' | 'swap' | 'added' | null;
}

export interface BatchItemClipsResponse {
  /** The staged list when `pendingRelist`, the rendered cut otherwise. */
  clips: BatchItemClip[];
  /** True when `clips` is the list the owner staged, not the one that rendered. */
  pendingRelist: boolean;
  textChanges: string[];
  hasStagedEdits: boolean;
  renderCount: number;
  /** The cut this list describes — a card compares it to the one it was born on. */
  attemptId: string;
}

export interface ApplyVideoEditsResponse {
  /** True when a render was started — by an edit, or by approving as-is. */
  applied: boolean;
  /**
   * - `edits`      — staged changes were committed and re-rendered
   * - `as_is`      — nothing was edited; the auto-assembled cut was approved
   * - `no_changes` — nothing edited and a cut already exists, so nothing ran
   */
  outcome: 'edits' | 'as_is' | 'no_changes';
  renderCount: number;
  /** The video now rendering — the FORK when an edit forked the previous cut. */
  videoId: string;
}

/** Body for POST /content-batches/items/:itemId/stage-clips. */
export interface StageItemClipsInput {
  /** The whole list, in render order — not a diff. */
  assetIds: string[];
}

export interface StageItemClipsResponse {
  clipCount: number;
  hasStagedEdits: boolean;
}

export interface DiscardVideoEditsResponse {
  /** False when there was nothing staged — a second Reject, most often. */
  discarded: boolean;
}

/** Body for POST /content-batches/items/:itemId/messages. */
export interface HandleReviewTurnInput {
  instruction: string;
}

/** Body for PATCH /content-batches/items/:itemId/caption. */
export interface UpdateBatchItemCaptionInput {
  caption: string;
}

// ============================================================================
// INPUT SHAPES (request bodies + query params)
// ============================================================================

export interface ListContentBatchesFilters extends PaginationParams {
  status?: ContentBatchStatus;
}

/**
 * Body for POST /content-batches/items/:itemId/regenerate.
 * Only the optional regenerate reason is needed — `itemId` is in the URL
 * and `organizationId` + `createdById` come from the session.
 */
export interface RegenerateBatchItemInput {
  reason?: string;
  /** For carousel graphics: 0-based slide to refine (omit = whole asset). */
  slideIndex?: number;
  /**
   * A per-slide instruction list — what the review thread proposes and the
   * owner confirms. Supersedes `reason`/`slideIndex`, which is what the plain
   * "Generate new image/video" button sends.
   */
  edits?: PendingRegenerateEdit[];
}

/**
 * Body for POST /content-batches/generate. All fields optional — the
 * server's Zod defaults fill in 4 graphics, 4 videos, and the current UTC
 * month when omitted. `organizationId` + `createdById` are supplied by
 * the controller from the session, not by the client.
 */
export interface GenerateContentBatchInput {
  /** YYYY-MM. Defaults to the current UTC month on the server. */
  periodMonth?: string;
  /** 0–10. Defaults to 4. */
  graphicCount?: number;
  /** 0–10. Defaults to 4. */
  videoCount?: number;
  /**
   * When true, seed fresh items into the existing month's batch instead of
   * no-opping when one already exists. The manual "Create Batch" button
   * sets this so re-clicking adds more content to review. Defaults to false
   * (idempotent) on the server.
   */
  append?: boolean;
  /**
   * When true, clear the existing month's batch (delete every pending item
   * and its referenced video/graphic rows) before seeding a fresh batch.
   * Takes precedence over `append`. Defaults to false on the server.
   */
  replace?: boolean;
  /**
   * Restrict the month's content to these service IDs only (a hard filter).
   * Omitted → the planner considers all active services (cron behaviour).
   * The "Create Batch" dialog passes the user's chosen services.
   */
  serviceIds?: string[];
  /**
   * Allow videos for services without uploaded footage to use curated stock.
   * Manual planner UI passes this from the stock-footage checkbox.
   */
  allowStockFootage?: boolean;
}

/**
 * Response from POST /content-batches/generate. Mirrors the backend
 * `RequestMonthlyBatchResponse`. The endpoint is ASYNC — it returns once the
 * batch row is prepared and the seed has been fired in the background, so
 * there are no seeded counts here. Watch progress by polling
 * GET /content-batches/current.
 *
 * - `queued: true` — background generation was kicked off. The returned
 *   `batch` is in `'planning'`; it flips to `'generating'` with items once
 *   the seed lands (poll to observe).
 * - `alreadyExisted: true` — a batch already existed and neither append nor
 *   replace was requested, so nothing was queued; the existing batch is
 *   returned untouched.
 */
export interface GenerateContentBatchResponse {
  batch: ContentBatch;
  alreadyExisted: boolean;
  queued: boolean;
  effectiveGraphicCount: number;
  effectiveVideoCount: number;
  jobId?: string;
}
