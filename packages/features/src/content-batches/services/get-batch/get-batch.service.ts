import {
  type ContentBatch,
  type ContentItem,
  type Graphic,
  type Video,
  contentBatch,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { type GetBatchInput, getBatchSchema } from './get-batch.schema.js';

/**
 * A slot flattened with its CURRENT attempt — what is on screen for this post
 * right now.
 *
 * The attempt's fields are lifted onto the slot rather than nested, so every
 * consumer keeps reading `item.caption` / `item.video` as before. That is
 * deliberate: the split is a storage change, and pushing it through every
 * template and test would be churn for no gain. What consumers no longer have
 * to do — and MUST no longer do — is work out which row is current. There is
 * one row per post here, always the live cut.
 *
 * Both `video` and `graphic` are carried and the consumer keys off `kind`,
 * because that is what the review UI needs to pick a card. Graphics and videos
 * are peers throughout: an image post regenerates, undoes and holds a thread
 * exactly like a video one.
 */
export interface ContentItemWithAsset extends ContentItem {
  video: Video | null;
  graphic: Graphic | null;
  /** The live attempt's id — what an undo moves away from. */
  attemptId: string;
  /** 0-based. 0 means "as first generated"; > 0 means it has been re-rolled. */
  attemptNumber: number;
  /** Copy for THIS cut. */
  caption: string | null;
  pendingVideoEdits: unknown;
  editRenderCount: number;
  regenerationReason: string | null;
  /**
   * Whether an earlier cut exists to go back to. Derived here rather than in
   * the UI so "can I undo" has one definition.
   */
  canUndoRegenerate: boolean;
}

export interface GetBatchResponse {
  batch: ContentBatch;
  items: ContentItemWithAsset[];
}

/**
 * Spread graphics and videos evenly through one queue instead of emitting all
 * graphics then all videos.
 *
 * Each item gets a fractional rank — its 0-based index within its own kind,
 * offset by a half-step and divided by that kind's total — so both kinds are
 * laid out across the same 0..1 line and then merged. With equal counts this
 * alternates exactly (G V G V …); with lopsided counts the rarer kind is
 * distributed through the common one rather than clumping into a tail. Ties
 * resolve graphic-first, and `position` breaks any remaining tie, so the order
 * is fully deterministic for a given batch.
 *
 * A regenerated replacement carries the same `kind` and `position` as the item
 * it supersedes, so it lands in the same slot its predecessor held.
 */
export function interleaveByKind<
  T extends { kind: string; position: number | null },
>(items: readonly T[]): T[] {
  // `position` is null for a standalone item — it only means something
  // relative to the other posts in a plan. Nulls sort last within their kind
  // and keep their insertion order relative to each other, which is the only
  // honest ordering available for them.
  const rank = (p: number | null) => p ?? Number.MAX_SAFE_INTEGER;
  const byKind = new Map<string, T[]>();
  for (const item of items) {
    const bucket = byKind.get(item.kind);
    if (bucket) bucket.push(item);
    else byKind.set(item.kind, [item]);
  }

  const ranked: { item: T; rank: number }[] = [];
  for (const bucket of byKind.values()) {
    bucket.sort((a, b) => rank(a.position) - rank(b.position));
    for (const [index, item] of bucket.entries()) {
      ranked.push({ item, rank: (index + 0.5) / bucket.length });
    }
  }

  return ranked
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.item.kind !== b.item.kind)
        return a.item.kind === 'graphic' ? -1 : 1;
      return rank(a.item.position) - rank(b.item.position);
    })
    .map((entry) => entry.item);
}

/**
 * Fetch a batch and its items (with the underlying video/graphic hydrated).
 *
 * The org check is enforced — passing a batch from another org returns
 * NOT_FOUND rather than FORBIDDEN to avoid leaking existence.
 *
 * Items are interleaved so graphics and videos alternate through the queue
 * rather than arriving as a block of graphics followed by a block of videos —
 * reviewing eight of one kind then eight of the other reads as two chores, and
 * the variety keeps a long queue moving. See `interleaveByKind`.
 *
 * ONE ROW PER POST. Every returned item is a slot flattened with its current
 * attempt. This used to return the superseded rows too and leave each caller to
 * filter them out by walking `previousItemId` — four frontend files hand-copied
 * that walk, and a fifth that forgot would have quietly rendered stale posts.
 * Superseded cuts are still in the database, reachable through the slot's
 * attempts; they are simply not what "the batch" means.
 */
const getBatchImpl = async (
  db: DbConnection,
  input: GetBatchInput
): Promise<Result<GetBatchResponse>> => {
  const parsed = getBatchSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const batch = await withOrgScope(
    (tx) =>
      tx.query.contentBatch.findFirst({
        where: and(
          eq(contentBatch.id, parsed.data.id),
          eq(contentBatch.organizationId, parsed.data.organizationId)
        ),
        with: {
          items: {
            with: {
              currentAttempt: { with: { video: true, graphic: true } },
              // Only what "can I go back?" needs. Pulling whole attempt rows
              // here would ship every superseded caption on every batch read.
              attempts: { columns: { attemptNumber: true } },
            },
          },
        },
      }),
    { db }
  );

  if (!batch) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Batch not found'));
  }

  const items = interleaveByKind(batch.items ?? [])
    // A slot without a current attempt is not a state the app can produce — the
    // slot and its attempt 0 are inserted in one transaction. Skipping rather
    // than throwing keeps one impossible row from blanking a whole batch the
    // owner is halfway through reviewing.
    .filter((slot) => slot.currentAttempt !== null)
    .map((slot) => {
      const { currentAttempt, attempts, ...slotRow } = slot;
      const attempt = currentAttempt as NonNullable<typeof currentAttempt>;
      return {
        ...slotRow,
        attemptId: attempt.id,
        attemptNumber: attempt.attemptNumber,
        caption: attempt.caption,
        pendingVideoEdits: attempt.pendingVideoEdits,
        editRenderCount: attempt.editRenderCount,
        regenerationReason: attempt.regenerationReason,
        video: attempt.video,
        graphic: attempt.graphic,
        // Strictly "is there an earlier cut", not "is the count below the cap".
        // Those differ after an undo: you are back on cut 1 with 2 spent, and
        // there is nothing further back to go.
        canUndoRegenerate: (attempts ?? []).some(
          (a) => a.attemptNumber < attempt.attemptNumber
        ),
      } as ContentItemWithAsset;
    });

  // Strip the `items` relation off the batch so the response shape matches
  // the `ContentBatch` entity type (drizzle returns the relation inline
  // when using `with`).
  const { items: _items, ...batchRow } = batch;
  void _items;

  return ok({ batch: batchRow, items });
};

export const getBatch = (db: DbConnection, input: GetBatchInput) =>
  trackedResult('contentBatches.getBatch', () => getBatchImpl(db, input), {
    properties: {
      organizationId: input.organizationId,
      batchId: input.id,
    },
    internalErrorsOnly: true,
  });

export type GetBatchResult = Awaited<ReturnType<typeof getBatch>>;
