import {
  type ContentAttempt,
  contentAttempt,
  contentItem,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, sql } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { loadPendingSlotForOrg } from '../_shared/index.js';
import {
  type UpdateBatchItemCaptionInput,
  updateBatchItemCaptionSchema,
} from './update-batch-item-caption.schema.js';

/**
 * Set the caption directly — hand-typed edits and revert-to-version.
 *
 * Writes to the ATTEMPT, not the slot: the caption describes the cut currently
 * on screen. Regenerate produces new words for new footage, and going back to
 * an earlier cut has to bring that cut's words with it, so a caption stored on
 * the slot would follow the owner across a re-roll and describe the wrong
 * video.
 *
 * No thread entry is written. The thread records the conversation with Claire;
 * the owner typing in the box is not a conversation, and logging "the owner
 * changed a word" as an assistant turn would make the history unreadable.
 * Reverting likewise: the version being restored is already in the thread.
 */
const updateBatchItemCaptionImpl = async (
  db: DbConnection,
  input: UpdateBatchItemCaptionInput
): Promise<Result<ContentAttempt>> => {
  const parsed = updateBatchItemCaptionSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { itemId, organizationId, caption } = parsed.data;

  const loaded = await loadPendingSlotForOrg(db, { itemId, organizationId });
  if (!loaded.success) return err(loaded.error);
  const { attempt } = loaded.data;

  try {
    const updated = await withOrgScope(
      (tx) =>
        tx
          .update(contentAttempt)
          .set({ caption })
          // Re-assert BOTH facts the guard above checked, because neither
          // survives the gap between reading and writing: the owner may have
          // accepted the post in another tab, or regenerated it, in which case
          // this caption belongs to a cut that is no longer on screen. The
          // correlated subquery keeps that check in the same statement rather
          // than a second round trip that could itself go stale.
          .where(
            and(
              eq(contentAttempt.id, attempt.id),
              sql`EXISTS (
                SELECT 1 FROM ${contentItem}
                WHERE ${contentItem.id} = ${itemId}
                  AND ${contentItem.reviewStatus} = 'pending'
                  AND ${contentItem.currentAttemptId} = ${attempt.id}
              )`
            )
          )
          .returning(),
      { db }
    );

    const result = updated[0];
    if (!result) {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'This post changed while you were editing — reload to see where it got to'
        )
      );
    }

    return ok(result);
  } catch (error) {
    logError('contentBatches.updateBatchItemCaption', error, {
      feature: 'content-batches',
      extra: { itemId, organizationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to save the caption')
    );
  }
};

export const updateBatchItemCaption = (
  db: DbConnection,
  input: UpdateBatchItemCaptionInput
) =>
  trackedResult(
    'contentBatches.updateBatchItemCaption',
    () => updateBatchItemCaptionImpl(db, input),
    {
      properties: {
        itemId: input.itemId,
        organizationId: input.organizationId,
      },
    }
  );

export type UpdateBatchItemCaptionResult = Awaited<
  ReturnType<typeof updateBatchItemCaption>
>;
