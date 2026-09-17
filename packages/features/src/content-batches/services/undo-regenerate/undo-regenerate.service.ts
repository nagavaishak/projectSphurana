import { randomUUID } from 'node:crypto';
import {
  type ContentItem,
  contentAttempt,
  contentItem,
  contentItemMessage,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, desc, eq, lt } from 'drizzle-orm';
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
  type UndoRegenerateInput,
  undoRegenerateSchema,
} from './undo-regenerate.schema.js';

export interface UndoRegenerateResponse {
  /** The slot. Unchanged by an undo, exactly as it is by a regenerate. */
  id: string;
  batchId: string;
  position: number;
  regenerationCount: number;
  /** The cut now live — the one before the one that was on screen. */
  attemptId: string;
  attemptNumber: number;
  /** That cut's asset, so the client can swap the card without a refetch. */
  videoId: string | null;
  graphicId: string | null;
  /** That cut's words. */
  caption: string | null;
  /** Whether there is a further cut back — i.e. can this be pressed again. */
  canUndoRegenerate: boolean;
  item: ContentItem;
}

/**
 * Go back to the previous cut of a post.
 *
 * This is one column write, and that is the entire point of the slot/attempt
 * split. Superseded attempts are never destroyed: the old video/graphic row and
 * its rendered blob are still there, so "back to the previous version" is a
 * pointer move — no render, no queue, no wait. Under the old linked-list model
 * the same feature was surgery on a chain, which is why it was designed and
 * never built.
 *
 * What it deliberately does NOT do:
 *
 *   - **No refund.** `regenerationCount` stays where it is. It is a record of
 *     renders actually paid for, not a budget to be handed back — decrementing
 *     it would make the meter understate what the batch cost.
 *   - **No re-render.** Nothing is enqueued, so this is instant and cannot fail
 *     halfway.
 *   - **No new attempt.** Undo is not itself a cut; it moves the pointer
 *     backwards over the history that is already there. Pressing it twice walks
 *     back two, and `canUndoRegenerate` says when there is nowhere left to go.
 *
 * Graphics and videos are identical here — neither branch appears below —
 * because after the split the only thing that differs between them is which
 * column of the attempt holds the asset.
 */
const undoRegenerateImpl = async (
  db: DbConnection,
  input: UndoRegenerateInput
): Promise<Result<UndoRegenerateResponse>> => {
  const parsed = undoRegenerateSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { itemId, organizationId } = parsed.data;

  const loaded = await loadPendingSlotForOrg(db, { itemId, organizationId });
  if (!loaded.success) return err(loaded.error);
  const { slot, attempt: current } = loaded.data;

  // Undo is a pointer move on a MONTHLY-PLAN slot: the response carries the
  // batch and position so the review page can re-render the post in place.
  // Narrowed once here rather than admitting nulls into the wire contract —
  // generalising undo to standalone items is its own change, with its own
  // response shape.
  if (slot.batchId === null || slot.position === null) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'This post is not part of a monthly plan',
        { itemId }
      )
    );
  }
  const batchId = slot.batchId;
  const position = slot.position;

  // The cut immediately before the live one. "Immediately before" by attempt
  // number rather than `current.attemptNumber - 1`, so a gap in the numbering
  // (a rolled-back insert leaves one) steps over it instead of finding nothing.
  const [previous] = await withOrgScope(
    (tx) =>
      tx
        .select()
        .from(contentAttempt)
        .where(
          and(
            eq(contentAttempt.slotId, slot.id),
            lt(contentAttempt.attemptNumber, current.attemptNumber)
          )
        )
        .orderBy(desc(contentAttempt.attemptNumber))
        .limit(1),
    { db }
  );

  if (!previous) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'There is no earlier version of this post to go back to',
        { attemptNumber: current.attemptNumber }
      )
    );
  }

  // Is there one further back still? Asked now, off the same history, so the
  // client can enable or disable the button from this response alone.
  const [beforePrevious] = await withOrgScope(
    (tx) =>
      tx
        .select({ id: contentAttempt.id })
        .from(contentAttempt)
        .where(
          and(
            eq(contentAttempt.slotId, slot.id),
            lt(contentAttempt.attemptNumber, previous.attemptNumber)
          )
        )
        .limit(1),
    { db }
  );

  const threadMessage = {
    id: randomUUID(),
    organizationId: slot.organizationId,
    batchId: slot.batchId,
    itemId: slot.id,
    role: 'assistant' as const,
    content: 'Reverted to the previous version.',
    // The caption AFTER this turn, same contract as every other assistant turn:
    // an undo changes the copy (the previous cut had its own), so the thread
    // has to record which words are now on screen or its history goes stale.
    captionSnapshot: previous.caption,
    createdAt: new Date(),
  };

  let updated: ContentItem;
  try {
    updated = await withOrgScope(
      (tx) =>
        (tx as DbConnection).transaction(async (trx) => {
          const [row] = await trx
            .update(contentItem)
            .set({ currentAttemptId: previous.id })
            .where(
              and(
                eq(contentItem.id, slot.id),
                eq(contentItem.reviewStatus, 'pending'),
                // Re-assert the cut we decided to move BACK FROM. Without this
                // an undo racing a regenerate would step back from a cut it
                // never saw, silently discarding the one the owner just paid
                // for.
                eq(contentItem.currentAttemptId, current.id)
              )
            )
            .returning();

          if (!row) {
            throw new FeatureError(
              ErrorCodes.CONFLICT,
              'This post changed while you were undoing — please refresh and try again'
            );
          }

          // In the transaction: a thread that says "reverted" against a pointer
          // that did not move is worse than no message at all.
          await trx.insert(contentItemMessage).values(threadMessage);

          return row;
        }),
      { db }
    );
  } catch (error) {
    if (error instanceof FeatureError) return err(error);
    logError('contentBatches.undoRegenerate', error, {
      feature: 'content-batches',
      extra: { itemId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to go back to the previous version'
      )
    );
  }

  // Undo moves the slot back onto an earlier cut, which is already rendered —
  // so a batch that was waiting on the re-roll may now be reviewable again.
  await settleBatchStatus(db, { batchId });

  return ok({
    id: updated.id,
    batchId,
    position,
    regenerationCount: updated.regenerationCount,
    attemptId: previous.id,
    attemptNumber: previous.attemptNumber,
    videoId: previous.videoId,
    graphicId: previous.graphicId,
    caption: previous.caption,
    canUndoRegenerate: Boolean(beforePrevious),
    item: updated,
  });
};

export const undoRegenerate = (db: DbConnection, input: UndoRegenerateInput) =>
  trackedResult(
    'contentBatches.undoRegenerate',
    () => undoRegenerateImpl(db, input),
    {
      properties: {
        itemId: input.itemId,
        organizationId: input.organizationId,
      },
    }
  );

export type UndoRegenerateResult = Awaited<ReturnType<typeof undoRegenerate>>;
