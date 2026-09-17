import {
  contentAttempt,
  contentItem,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
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
  hasStagedEdits,
  parsePendingVideoEdits,
} from '../handle-review-turn/video-edits.js';
import {
  type DiscardItemVideoEditsInput,
  type DiscardItemVideoEditsResponse,
  discardItemVideoEditsSchema,
} from './discard-item-video-edits.schema.js';

/**
 * Throw away everything staged against this cut. The video is untouched.
 *
 * The counterpart to `applyBatchItemVideoEdits` and the other half of the
 * approval the card asks for: approving renders, rejecting has to leave no
 * trace, or the next Apply would commit an edit the owner explicitly declined.
 *
 * Clears the TEXT patch as well as the clip operations, and a proposed RE-ROLL
 * with them. Rejecting is a decision about the pending change as a whole — the
 * card shows everything staged together and offers one Reject — so leaving half
 * of it behind would honour a button the owner never saw.
 *
 * The re-roll lives on the SLOT rather than the attempt (`pendingRegenerate`),
 * and nothing cleared it: only `regenerateBatchItem` did, on the way to
 * spending it. So a declined re-roll came back on the next load, still offering
 * to spend a render the owner had already said no to.
 *
 * Nothing staged is not a failure. A second press, or a press after the edits
 * were applied in another tab, should report calmly rather than 404.
 */
const discardItemVideoEditsImpl = async (
  db: DbConnection,
  input: DiscardItemVideoEditsInput
): Promise<Result<DiscardItemVideoEditsResponse>> => {
  const parsed = discardItemVideoEditsSchema.safeParse(input);
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
  const { attempt, slot } = loaded.data;

  const hasVideoEdits = hasStagedEdits(
    parsePendingVideoEdits(attempt.pendingVideoEdits)
  );
  const hasProposedReRoll = Array.isArray(slot.pendingRegenerate)
    ? slot.pendingRegenerate.length > 0
    : false;

  if (!hasVideoEdits && !hasProposedReRoll) {
    return ok({ discarded: false });
  }

  try {
    await withOrgScope(
      async (tx) => {
        if (hasVideoEdits) {
          await tx
            .update(contentAttempt)
            .set({ pendingVideoEdits: null })
            .where(eq(contentAttempt.id, attempt.id));
        }
        if (hasProposedReRoll) {
          await tx
            .update(contentItem)
            .set({ pendingRegenerate: null })
            .where(eq(contentItem.id, slot.id));
        }
      },
      { db }
    );
  } catch (error) {
    logError('contentBatches.discardItemVideoEdits', error, {
      feature: 'content-batches',
      extra: { itemId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to discard those changes'
      )
    );
  }

  return ok({ discarded: true });
};

export const discardItemVideoEdits = (
  db: DbConnection,
  input: DiscardItemVideoEditsInput
) =>
  trackedResult(
    'contentBatches.discardItemVideoEdits',
    () => discardItemVideoEditsImpl(db, input),
    {
      properties: {
        itemId: input.itemId,
        organizationId: input.organizationId,
      },
    }
  );

export type DiscardItemVideoEditsResult = Awaited<
  ReturnType<typeof discardItemVideoEdits>
>;
