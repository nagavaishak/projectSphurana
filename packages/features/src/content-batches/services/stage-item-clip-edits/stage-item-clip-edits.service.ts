import {
  type PendingClipOperation,
  contentAttempt,
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
import { parsePendingVideoEdits } from '../handle-review-turn/video-edits.js';
import {
  type StageItemClipEditsInput,
  type StageItemClipEditsResponse,
  stageItemClipEditsSchema,
} from './stage-item-clip-edits.schema.js';

/**
 * Stage the clip list the owner just edited, without rendering anything.
 *
 * WHY THIS IS A WRITE AND NOT COMPONENT STATE
 * -------------------------------------------
 * Five attempts at this feature failed on the same seam: the card held the
 * owner's edit somewhere Claire could not read. Saving forked a video whose id
 * lived only in a React hook, so "render it now" looked up the ORIGINAL, found
 * it ready, and truthfully reported nothing to do. Holding the list in the
 * browser has the same defect without the persistence — the one party who has
 * to act on the choice is the one party who never sees it.
 *
 * Staging on the attempt puts the edit where every tool already looks. Claire
 * addresses the item; `listBatchItemClips` reads this back; the owner's edit
 * survives a refresh. Nothing renders until they approve it, so the write costs
 * nothing but a row update.
 *
 * REPLACES any previously staged clip operations rather than appending. The
 * list is absolute — a second pass through the editor is the owner's latest
 * word on the whole list, not another instruction to fold in — and stacking a
 * relist on top of an earlier `swap` would apply the swap to positions that no
 * longer mean what they meant when it was staged.
 *
 * The on-screen TEXT patch is preserved: it addresses a different part of the
 * draft, it was staged by a different surface, and dropping it here would lose
 * an edit the owner watched Claire make.
 */
const stageItemClipEditsImpl = async (
  db: DbConnection,
  input: StageItemClipEditsInput
): Promise<Result<StageItemClipEditsResponse>> => {
  const parsed = stageItemClipEditsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { itemId, organizationId, assetIds } = parsed.data;

  const loaded = await loadPendingSlotForOrg(db, { itemId, organizationId });
  if (!loaded.success) return err(loaded.error);
  const { slot, attempt } = loaded.data;

  if (slot.kind !== 'video' || !attempt.videoId) {
    return err(
      new FeatureError(ErrorCodes.INVALID_STATE, 'This post is not a video')
    );
  }

  const existing = parsePendingVideoEdits(attempt.pendingVideoEdits);
  const clipOperations: PendingClipOperation[] = [
    { op: 'replace-all', assetIds },
  ];

  try {
    await withOrgScope(
      (tx) =>
        tx
          .update(contentAttempt)
          .set({
            pendingVideoEdits: { clipOperations, patch: existing.patch },
          })
          .where(eq(contentAttempt.id, attempt.id)),
      { db }
    );
  } catch (error) {
    logError('contentBatches.stageItemClipEdits', error, {
      feature: 'content-batches',
      extra: { itemId, organizationId, clipCount: assetIds.length },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to stage those clips')
    );
  }

  return ok({ clipCount: assetIds.length, hasStagedEdits: true });
};

export const stageItemClipEdits = (
  db: DbConnection,
  input: StageItemClipEditsInput
) =>
  trackedResult(
    'contentBatches.stageItemClipEdits',
    () => stageItemClipEditsImpl(db, input),
    {
      properties: {
        itemId: input.itemId,
        organizationId: input.organizationId,
        clipCount: input.assetIds?.length,
      },
    }
  );

export type StageItemClipEditsResult = Awaited<
  ReturnType<typeof stageItemClipEdits>
>;
