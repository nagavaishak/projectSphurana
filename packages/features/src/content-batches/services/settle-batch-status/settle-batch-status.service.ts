/**
 * `settleBatchStatus` — recompute a batch's status from its items and write it
 * if it moved.
 *
 * A batch used to enter `'generating'` at the end of the seed and stay there
 * forever: `'review'` and `'completed'` were enum values with no writer. Every
 * surface that wanted to know "is this batch done?" had to re-derive the answer
 * from the items, and the one place that could not — the raw status readout on
 * the style settings page — simply lied (ENG-788). A server-side consumer, like
 * a proactive Claire that wants to speak up the moment a batch is ready to
 * review, has no client to derive anything for it.
 *
 * So the status is settled here, from the items, at every point that can change
 * the answer:
 *
 *   - the worker, when a render reaches `ready` / `failed`
 *   - the seed, once slots exist (a sample-asset batch is born fully rendered)
 *   - accept / reject, when the last pending item is decided
 *   - regenerate / undo / video edits, which put a slot BACK into rendering
 *
 * Recomputed, never patched incrementally: a status derived from the current
 * items cannot drift, whereas a counter or a one-way flag eventually disagrees
 * with the rows. The transitions are:
 *
 *   any pending item still rendering → 'generating'
 *   items pending, none rendering    → 'review'
 *   nothing left pending             → 'completed'
 *
 * `'planning'` and `'failed'` are never settled OUT of. `'planning'` means a
 * seed is in flight and the slots on the table are not yet the whole batch —
 * settling it would re-introduce exactly the "done!" that this fixes, a
 * few slots early. `'failed'` is the owner's to retry.
 */

import {
  contentAttempt,
  contentBatch,
  withOrgScope,
} from '@borradh-workspace/database';
import type { ContentBatchStatus } from '@borradh-workspace/labels';
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
import {
  type SettleBatchForAssetInput,
  type SettleBatchStatusInput,
  settleBatchForAssetSchema,
  settleBatchStatusSchema,
} from './settle-batch-status.schema.js';

export interface SettleBatchStatusResponse {
  batchId: string;
  /** The batch's status after settling — unchanged if it was already right. */
  status: ContentBatchStatus;
  /**
   * True exactly once per transition, even when several renders finish at the
   * same moment: the write is conditional on the status we read. A caller that
   * wants to act on "this batch just became reviewable" (notify, nudge, hand
   * it to Claire) can key off this without deduplicating.
   */
  changed: boolean;
  /** Pending items in the current cut — the review queue's size. */
  pending: number;
  /** How many of those are still waiting on a render. */
  rendering: number;
}

/** Statuses that describe a settled batch, and so may be settled between. */
const SETTLEABLE = new Set<ContentBatchStatus>([
  'generating',
  'review',
  'scheduling',
  'completed',
]);

const settleBatchStatusImpl = async (
  db: DbConnection,
  input: SettleBatchStatusInput
): Promise<Result<SettleBatchStatusResponse>> => {
  const parsed = settleBatchStatusSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { batchId } = parsed.data;

  const batch = await withOrgScope(
    (tx) =>
      tx.query.contentBatch.findFirst({
        where: eq(contentBatch.id, batchId),
        columns: { id: true, status: true },
        with: {
          items: {
            columns: { id: true, kind: true, reviewStatus: true },
            with: {
              currentAttempt: {
                columns: { id: true },
                with: {
                  video: { columns: { status: true } },
                  graphic: { columns: { status: true } },
                },
              },
            },
          },
        },
      }),
    { db }
  );

  if (!batch) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Batch not found'));
  }

  const current = batch.status as ContentBatchStatus;
  const items = batch.items ?? [];

  const unchanged = (status: ContentBatchStatus, pending = 0, rendering = 0) =>
    ok({ batchId, status, changed: false, pending, rendering });

  // A batch mid-seed or failed is not ours to move. An EMPTY batch is the same
  // case wearing different clothes: the seed inserts slots one at a time, so
  // "no items" is a moment during seeding, not a finished batch with nothing
  // in it — calling it 'completed' would re-arm the create button mid-seed.
  if (!SETTLEABLE.has(current) || items.length === 0) {
    return unchanged(current);
  }

  let pending = 0;
  let rendering = 0;
  for (const item of items) {
    if (item.reviewStatus !== 'pending') continue;
    pending += 1;
    const attempt = item.currentAttempt;
    const status =
      item.kind === 'graphic'
        ? attempt?.graphic?.status
        : attempt?.video?.status;
    // A missing status counts as rendering, not as done — the same rule the
    // review banner uses. A slot whose asset row has not landed yet is work
    // outstanding, and guessing "ready" would announce a batch that isn't.
    if (!status || (status !== 'ready' && status !== 'failed')) rendering += 1;
  }

  const next: ContentBatchStatus =
    rendering > 0 ? 'generating' : pending > 0 ? 'review' : 'completed';

  if (next === current) return unchanged(current, pending, rendering);

  // Conditional on the status we read, so concurrent finishers settle once
  // between them: the second update matches no row and reports `changed:false`.
  const [updated] = await withOrgScope(
    (tx) =>
      tx
        .update(contentBatch)
        .set({ status: next, updatedAt: new Date() })
        .where(
          and(eq(contentBatch.id, batchId), eq(contentBatch.status, current))
        )
        .returning({ id: contentBatch.id }),
    { db }
  );

  return ok({
    batchId,
    status: updated ? next : current,
    changed: !!updated,
    pending,
    rendering,
  });
};

/**
 * Settle the batch a just-rendered asset belongs to.
 *
 * Standalone content (no batch) resolves to nothing and is a no-op — the
 * worker renders both and cannot tell them apart at the call site.
 */
const settleBatchForAssetImpl = async (
  db: DbConnection,
  input: SettleBatchForAssetInput
): Promise<Result<SettleBatchStatusResponse | null>> => {
  const parsed = settleBatchForAssetSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { graphicId, videoId } = parsed.data;

  const attempt = await withOrgScope(
    (tx) =>
      tx.query.contentAttempt.findFirst({
        where: graphicId
          ? eq(contentAttempt.graphicId, graphicId)
          : eq(contentAttempt.videoId, videoId as string),
        columns: { batchId: true },
      }),
    { db }
  );

  if (!attempt?.batchId) return ok(null);

  return settleBatchStatusImpl(db, { batchId: attempt.batchId });
};

export const settleBatchStatus = (
  db: DbConnection,
  input: SettleBatchStatusInput
) =>
  trackedResult(
    'contentBatches.settleBatchStatus',
    () => settleBatchStatusImpl(db, input),
    { properties: { batchId: input.batchId } }
  );

export const settleBatchForAsset = (
  db: DbConnection,
  input: SettleBatchForAssetInput
) =>
  trackedResult(
    'contentBatches.settleBatchForAsset',
    () => settleBatchForAssetImpl(db, input),
    { properties: { ...input } }
  );

export type SettleBatchStatusResult = Awaited<
  ReturnType<typeof settleBatchStatus>
>;
