import { randomUUID } from 'node:crypto';
import {
  type ContentAttempt,
  contentAttempt,
  contentItem,
} from '@borradh-workspace/database';
import { and, desc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';

export interface RecordAttemptInput {
  itemId: string;
  organizationId: string;
  /** Exactly one, matching the item's `kind`. */
  videoId?: string | null;
  graphicId?: string | null;
  caption?: string | null;
  /**
   * What the owner asked for, in their words. The whole reason an attempt is a
   * row: without it a re-roll is indistinguishable from a fresh generate, which
   * is the state graphics and videos are in today.
   */
  reason?: string | null;
  /**
   * Whether this cut counts against the item's AI re-roll cap. Defaults true,
   * which is right for a regenerate: the owner asked the planner for another
   * go and that is what the cap bounds.
   *
   * The clip list editor passes FALSE. Reordering the clips the owner already
   * approved is not indecision about the idea, and charging it to the same
   * meter would let a drag of two thumbnails exhaust their ability to finish
   * the post. `editRenderCount` is where that cost is recorded instead.
   */
  countsAsRegeneration?: boolean;
  /**
   * Carried onto the new cut so a tally that belongs to the ITEM survives the
   * fork. Left at 0 and the meter resets every time an edit forks, which would
   * report a post on its fifth re-render as being on its first.
   */
  editRenderCount?: number;
}

/**
 * Append a cut to an item and make it the live one.
 *
 * The counterpart to `insertSlotWithFirstAttempt`: that one opens an item with
 * attempt 0, this one adds attempt N and moves the pointer. Between them they
 * are the ONLY two ways `content_attempt` is written, which is what keeps
 * "which cut is live" a fact rather than a convention each caller re-derives.
 *
 * Both writes plus the pointer move are one transaction. A half-applied append
 * would either leave an attempt nothing points at (invisible, and it would take
 * the next attempt's number) or a pointer at a row that was rolled back.
 *
 * `attemptNumber` is read inside the transaction and the table has a unique
 * index on `(slot_id, attempt_number)`, so two concurrent re-rolls cannot both
 * claim N — the loser fails the insert instead of silently overwriting the
 * other's history. Callers surface that as "try again", which is honest: two
 * people pressed regenerate and only one cut can be live.
 *
 * `regenerationCount` is bumped on the item and is NOT decremented by undo:
 * those renders were really paid for, and giving them back would make the
 * meter understate what the item cost.
 */
export const recordAttempt = async (
  db: DbConnection,
  input: RecordAttemptInput
): Promise<Result<ContentAttempt>> => {
  if (!input.videoId && !input.graphicId) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'An attempt needs a video or a graphic',
        { itemId: input.itemId }
      )
    );
  }
  if (input.videoId && input.graphicId) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'An attempt carries a video or a graphic, not both',
        { itemId: input.itemId }
      )
    );
  }

  try {
    const appended = await db.transaction(async (trx) => {
      const [slot] = await trx
        .select({
          id: contentItem.id,
          batchId: contentItem.batchId,
          regenerationCount: contentItem.regenerationCount,
        })
        .from(contentItem)
        .where(
          and(
            eq(contentItem.id, input.itemId),
            eq(contentItem.organizationId, input.organizationId)
          )
        )
        .limit(1);

      if (!slot) return null;

      const [latest] = await trx
        .select({ attemptNumber: contentAttempt.attemptNumber })
        .from(contentAttempt)
        .where(eq(contentAttempt.slotId, slot.id))
        .orderBy(desc(contentAttempt.attemptNumber))
        .limit(1);

      const attemptId = randomUUID();
      const [row] = await trx
        .insert(contentAttempt)
        .values({
          id: attemptId,
          organizationId: input.organizationId,
          slotId: slot.id,
          // Inherited from the item, not passed in: an attempt belongs to
          // whatever grouping its item belongs to, and letting a caller state
          // it separately is how the two drift apart.
          batchId: slot.batchId,
          attemptNumber: (latest?.attemptNumber ?? -1) + 1,
          videoId: input.videoId ?? null,
          graphicId: input.graphicId ?? null,
          caption: input.caption ?? null,
          regenerationReason: input.reason ?? null,
          editRenderCount: input.editRenderCount ?? 0,
        })
        .returning();

      await trx
        .update(contentItem)
        .set({
          currentAttemptId: attemptId,
          regenerationCount:
            slot.regenerationCount +
            (input.countsAsRegeneration === false ? 0 : 1),
          // A new cut SPENDS any proposal that was waiting.
          //
          // `pendingRegenerate` is a re-roll the owner has been offered and not
          // yet paid for. Recording an attempt means one just happened, so
          // leaving the proposal behind would keep the button on screen
          // offering to spend a second render for a change already made.
          // Cleared here rather than in each caller: `regenerateBatchItem`
          // cleared it and the graphic path did not, which is exactly the kind
          // of split that leaves one branch right and the other wrong.
          pendingRegenerate: null,
        })
        .where(eq(contentItem.id, slot.id));

      return row;
    });

    if (!appended) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Item not found', {
          itemId: input.itemId,
        })
      );
    }

    return ok(appended);
  } catch (error) {
    const msg = error instanceof Error ? error.message : '';
    // The unique index on (slot_id, attempt_number) firing means someone else's
    // re-roll landed first. That is a conflict, not an internal error, and the
    // caller can act on it.
    if (msg.includes('idx_content_attempt_slot_number')) {
      return err(
        new FeatureError(
          ErrorCodes.CONFLICT,
          'Another version of this post was created at the same time — try again',
          { itemId: input.itemId }
        )
      );
    }
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to record the attempt'
      )
    );
  }
};
