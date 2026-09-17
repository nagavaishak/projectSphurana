import { contentBatch, withOrgScope } from '@borradh-workspace/database';
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
  type DeleteCurrentBatchInput,
  deleteCurrentBatchSchema,
} from './delete-current-batch.schema.js';

export interface DeleteCurrentBatchResult {
  /** True when a batch existed and was removed; false when there was none. */
  deleted: boolean;
  /** Id of the removed batch, when one existed. */
  batchId?: string;
}

/**
 * Clear the current month's content batch so a fresh one can be generated.
 *
 * Deletes ONLY the `content_batch` row. Its `content_batch_item` rows are
 * removed automatically (FK `onDelete: 'cascade'`), but the generated
 * `video`/`graphic` rows survive — those FKs are `onDelete: 'set null'` and
 * live on the item side, so the assets stay in the library. Social posts that
 * were created from accepted items are likewise untouched (nothing references
 * the batch items). After this `getCurrentBatch` returns the next-newest batch,
 * or 404s when that was the last one, and the planner's Bulk Create button
 * re-enables.
 *
 * "Current" means the same thing here as it does in `getCurrentBatch` — the
 * most recently created batch — because the two are a matched pair: whatever
 * the planner shows is what this resets. Any drift between them makes the
 * reset button appear broken.
 *
 * Idempotent: resetting with no batch present is a no-op (`deleted: false`).
 */
const deleteCurrentBatchImpl = async (
  db: DbConnection,
  input: DeleteCurrentBatchInput
): Promise<Result<DeleteCurrentBatchResult>> => {
  const result = deleteCurrentBatchSchema.safeParse(input);
  if (!result.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: result.error.issues,
      })
    );
  }
  const parsed = result.data;
  const periodMonth = parsed.periodMonth;

  // Resolve EXACTLY the batch `getCurrentBatch` shows: the most recently
  // created one, with `periodMonth` as an explicit filter only.
  //
  // This used to default to the current UTC month AND use `findFirst` with no
  // ordering, disagreeing with the read on both counts. Owners click generate
  // on their own schedule, so several batches carry the same month label —
  // reset deleted an arbitrary one (usually an older row) while the planner
  // kept showing the newest, so the button looked like it did nothing. And a
  // batch made before the month rolled over could not be reset at all: the
  // lookup matched no row and reported "no batch to reset" about a batch
  // sitting right there on screen.
  const batch = await withOrgScope(
    (tx) =>
      tx.query.contentBatch.findFirst({
        where: periodMonth
          ? and(
              eq(contentBatch.organizationId, parsed.organizationId),
              eq(contentBatch.periodMonth, periodMonth)
            )
          : eq(contentBatch.organizationId, parsed.organizationId),
        orderBy: (b, { desc }) => [desc(b.createdAt)],
        columns: { id: true },
      }),
    { db }
  );

  if (!batch) return ok({ deleted: false });

  // Delete the batch row only. Items cascade away; the video/graphic rows they
  // pointed at stay (set-null FK on the item side), as do any social posts.
  await withOrgScope(
    (tx) => tx.delete(contentBatch).where(eq(contentBatch.id, batch.id)),
    { db }
  );

  return ok({ deleted: true, batchId: batch.id });
};

export const deleteCurrentBatch = (
  db: DbConnection,
  input: DeleteCurrentBatchInput
) =>
  trackedResult(
    'contentBatches.deleteCurrentBatch',
    () => deleteCurrentBatchImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type DeleteCurrentBatchServiceResult = Awaited<
  ReturnType<typeof deleteCurrentBatch>
>;
