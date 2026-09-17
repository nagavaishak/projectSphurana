import {
  type ContentItem,
  contentItem,
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
import { loadPendingSlotForOrg } from '../_shared/index.js';
import { settleBatchStatus } from '../settle-batch-status/index.js';
import {
  type RejectBatchItemInput,
  rejectBatchItemSchema,
} from './reject-batch-item.schema.js';

/**
 * Reject a post. Unlike accept, this drops the slot with no replacement and no
 * follow-up social post — the owner has decided it just isn't worth shipping.
 * Other slots in the batch are unaffected.
 *
 * A decision, so it writes to the SLOT. Which cut happened to be on screen is
 * irrelevant: rejecting is about the post, and every attempt goes with it.
 *
 * Returns INVALID_STATE if the post has already been decided — the UI shouldn't
 * allow it, but a double-tap shouldn't silently re-decide either.
 */
const rejectBatchItemImpl = async (
  db: DbConnection,
  input: RejectBatchItemInput
): Promise<Result<ContentItem>> => {
  const parsed = rejectBatchItemSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const loaded = await loadPendingSlotForOrg(db, {
    itemId: parsed.data.itemId,
    organizationId: parsed.data.organizationId,
  });
  if (!loaded.success) return err(loaded.error);

  const [updated] = await withOrgScope(
    (tx) =>
      tx
        .update(contentItem)
        .set({
          reviewStatus: 'rejected',
          decidedAt: new Date(),
        })
        .where(
          and(
            eq(contentItem.id, parsed.data.itemId),
            eq(contentItem.reviewStatus, 'pending')
          )
        )
        .returning(),
    { db }
  );

  if (!updated) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'Concurrent update — please refresh and try again'
      )
    );
  }

  // Deciding an item can empty the review queue, which is what 'completed'
  // means. Recomputed rather than counted down, so it stays right however the
  // queue got there. Best-effort: the accept has already happened, and a stale
  // batch status must not turn a rejection look like a failure.
  if (updated.batchId) {
    await settleBatchStatus(db, { batchId: updated.batchId });
  }

  return ok(updated);
};

export const rejectBatchItem = (
  db: DbConnection,
  input: RejectBatchItemInput
) =>
  trackedResult(
    'contentBatches.rejectBatchItem',
    () => rejectBatchItemImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        itemId: input.itemId,
      },
    }
  );

export type RejectBatchItemResult = Awaited<ReturnType<typeof rejectBatchItem>>;
