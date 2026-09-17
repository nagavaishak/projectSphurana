import { randomUUID } from 'node:crypto';
import {
  type PendingClipOperation,
  contentAttempt,
  contentItemMessage,
  video as videoTable,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq, sql } from 'drizzle-orm';
import { reviseContent } from '../../../content-items/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { queueVideoExport } from '../../../videos/index.js';
import { loadPendingSlotForOrg } from '../_shared/index.js';
import {
  hasStagedEdits,
  parsePendingVideoEdits,
} from '../handle-review-turn/video-edits.js';
import { settleBatchStatus } from '../settle-batch-status/index.js';
import {
  type ApplyBatchItemVideoEditsInput,
  type ApplyBatchItemVideoEditsResponse,
  applyBatchItemVideoEditsSchema,
} from './apply-batch-item-video-edits.schema.js';

/** "Removed clip 1 · Swapped clip 2 · 1 text change" — what the thread records. */
function describe(
  clipOperations: PendingClipOperation[],
  textChangeCount: number
): string {
  const parts = clipOperations.map((op) => {
    if (op.op === 'replace-all') {
      return `set the clips to ${op.assetIds.length} in a new order`;
    }
    return op.op === 'remove'
      ? `removed clip ${op.index + 1}`
      : `swapped clip ${op.index + 1}`;
  });
  if (textChangeCount > 0) {
    parts.push(
      `updated ${textChangeCount} text field${textChangeCount === 1 ? '' : 's'}`
    );
  }
  const summary = parts.join(', ');
  return `Applied: ${summary}. Re-rendering now — it'll take a minute or two.`;
}

/**
 * Render the cut as it stands, unless one already exists.
 *
 * `blobUrl` and not `status` is the discriminator, for the same reason
 * `patchDraftConfig` uses it: a patch resets status to 'draft' while leaving
 * the previous render's URL in place, so status says "draft" about a video the
 * owner has already watched.
 */
async function renderAsIs(
  db: DbConnection,
  args: { videoId: string; organizationId: string }
): Promise<Result<{ queued: boolean }>> {
  const [row] = await withOrgScope(
    (tx) =>
      tx
        .select({ blobUrl: videoTable.blobUrl, status: videoTable.status })
        .from(videoTable)
        .where(eq(videoTable.id, args.videoId))
        .limit(1),
    { db }
  );

  if (!row) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Video not found'));
  }
  // Already rendered, or already on its way — either way there is nothing for
  // an unchanged approval to start.
  if (row.blobUrl || row.status === 'queued' || row.status === 'processing') {
    return ok({ queued: false });
  }

  const queued = await queueVideoExport(db, { id: args.videoId });
  if (!queued.success) {
    return err(
      new FeatureError(
        queued.error.code,
        queued.error.message,
        queued.error.details
      )
    );
  }
  return ok({ queued: true });
}

/**
 * Commit every staged video edit on an item, in ONE render.
 *
 * This is the only place staged edits become real. Batching is the whole point:
 * "remove clip 1, change clip 2, fix the text" is three instructions and one
 * render, not three renders each superseding the last mid-flight.
 *
 * `reviseContent` does the actual work — underneath it, `patchDraftConfig`
 * applies the named clip operations to the STORED list (so clips nobody
 * mentioned survive, per `CLIP_OPERATION_CONTRACTS`), deep-merges the text
 * patch, and re-queues the render. Those services already own the ordering and
 * copy-on-write rules; duplicating them here is how the two would drift.
 *
 * Deliberately does NOT touch `regenerationCount`. That cap bounds AI re-rolls;
 * `editRenderCount` counts these instead, so the cost is visible without a
 * typo fix being able to exhaust someone's ability to finish the post.
 */
const applyBatchItemVideoEditsImpl = async (
  db: DbConnection,
  input: ApplyBatchItemVideoEditsInput
): Promise<Result<ApplyBatchItemVideoEditsResponse>> => {
  const parsed = applyBatchItemVideoEditsSchema.safeParse(input);
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
  const { slot, attempt } = loaded.data;

  if (!attempt.videoId) {
    return err(
      new FeatureError(ErrorCodes.INVALID_STATE, 'This post is not a video')
    );
  }

  const edits = parsePendingVideoEdits(attempt.pendingVideoEdits);

  // APPROVING AS-IS. Nothing was edited, and that is a legitimate answer —
  // arguably the common one.
  //
  // This used to return `applied: false` and stop, which made the card's Accept
  // dead until the owner changed something. The clips are auto-assembled at
  // create precisely so they do not have to: being shown a finished video and
  // made to edit it before you are allowed to say yes is the shape of the bug,
  // not a safeguard against it.
  //
  // A cut that ALREADY rendered is the one case with nothing to do. Spending a
  // render to reproduce the frames already on screen is worse than saying so.
  if (!hasStagedEdits(edits)) {
    const rendered = await renderAsIs(db, {
      videoId: attempt.videoId,
      organizationId,
    });
    if (!rendered.success) return err(rendered.error);

    // Count it. An unchanged approval starts a real render, so it belongs on
    // the same meter as an edited one — and the count is what tells a CARD its
    // decision has already been made. Without it, approving as-is left every
    // observable value on the item exactly as it was, so a card reloaded
    // afterwards could not tell it had been approved and offered Accept again.
    if (rendered.data.queued) {
      await withOrgScope(
        (tx) =>
          tx
            .update(contentAttempt)
            .set({
              editRenderCount: sql`${contentAttempt.editRenderCount} + 1`,
            })
            .where(eq(contentAttempt.id, attempt.id)),
        { db }
      );
    }

    return ok({
      applied: rendered.data.queued,
      outcome: rendered.data.queued ? 'as_is' : 'no_changes',
      renderCount: attempt.editRenderCount + (rendered.data.queued ? 1 : 0),
      // Unchanged means no fork, so the cut being rendered is the one the
      // caller already had.
      videoId: attempt.videoId,
    });
  }

  // Through `reviseContent`, NOT `patchDraftConfig` directly.
  //
  // The difference is copy-on-write. A patch straight to the draft config
  // re-renders over `blobUrl`, so the cut the owner watched and approved before
  // asking for a change is simply gone. Revising forks it instead and records
  // the fork as the item's next attempt, which is also what keeps the edit
  // REACHABLE: the item now points at the new video, so the next thing anyone
  // asks about this post — Claire included — finds the cut the owner edited
  // rather than the one they replaced.
  //
  // The caption and the render tally ride along because both are per-attempt.
  // Left off, a clip reorder would blank the post text and reset a meter that
  // describes the item.
  const patched = await reviseContent(db, {
    kind: 'video',
    videoId: attempt.videoId,
    organizationId,
    patch: edits.patch,
    clipOperations: edits.clipOperations,
    requeueRender: true,
    source: 'content_studio',
    caption: attempt.caption,
    editRenderCount: attempt.editRenderCount + 1,
    // A considered clip change is not indecision about the idea, and the
    // re-roll cap is what bounds indecision. `editRenderCount` above is where
    // this cost is recorded.
    countsAsRegeneration: false,
  });

  if (!patched.success) {
    // Leave the staged edits in place. A failed apply that also cleared them
    // would lose work the owner watched Claire stage.
    return err(
      new FeatureError(
        patched.error.code,
        patched.error.message,
        patched.error.details
      )
    );
  }

  // `reviseContent` returns a union keyed on `kind`. This path only ever asks
  // for a video, so anything else is a contract break rather than a state to
  // handle — narrow once, here, and the rest of the function keeps its types.
  if (patched.data.kind !== 'video') {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Expected a video revision for this post'
      )
    );
  }
  const revised = patched.data;

  const forked = Boolean(revised.forkedFromVideoId);
  const renderCount = attempt.editRenderCount + 1;
  const now = new Date();

  try {
    await withOrgScope(
      (tx) =>
        (tx as DbConnection).transaction(async (trx) => {
          // Clearing the staged edits lands on the attempt they were staged
          // against, forked or not: they are spent either way, and leaving them
          // on a superseded cut would re-apply them if the owner stepped back
          // to it. The thread entry below goes to the SLOT, because the
          // conversation is the post's, not the cut's, and it has to survive
          // the next regenerate.
          //
          // The render is only counted here when nothing forked. A fork carries
          // the incremented tally onto the new attempt (see `editRenderCount`
          // above), and counting it in both places would report one render as
          // two.
          await trx
            .update(contentAttempt)
            .set({
              pendingVideoEdits: null,
              ...(forked
                ? {}
                : {
                    editRenderCount: sql`${contentAttempt.editRenderCount} + 1`,
                  }),
            })
            .where(eq(contentAttempt.id, attempt.id));

          await trx.insert(contentItemMessage).values([
            {
              id: randomUUID(),
              organizationId: slot.organizationId,
              batchId: slot.batchId,
              itemId,
              role: 'assistant' as const,
              content: describe(
                edits.clipOperations,
                Object.keys(edits.patch).length
              ),
              captionSnapshot: null,
              createdAt: now,
            },
          ]);
        }),
      { db }
    );
  } catch (error) {
    // The render IS queued at this point. Log loudly: the owner will see the
    // new cut, but the staged edits would re-apply on a second press.
    logError('contentBatches.applyBatchItemVideoEdits.clear', error, {
      feature: 'content-batches',
      extra: { itemId, organizationId, videoId: attempt.videoId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'The re-render started but we could not clear the staged edits'
      )
    );
  }

  // Committing edits kicks a fresh render, so this slot is outstanding again
  // and the batch is no longer reviewable.
  if (slot.batchId) {
    await settleBatchStatus(db, { batchId: slot.batchId });
  }

  return ok({
    applied: true,
    outcome: 'edits' as const,
    renderCount,
    // The FORK when it forked, the same row when it did not.
    videoId: revised.video.id,
  });
};

export const applyBatchItemVideoEdits = (
  db: DbConnection,
  input: ApplyBatchItemVideoEditsInput
) =>
  trackedResult(
    'contentBatches.applyBatchItemVideoEdits',
    () => applyBatchItemVideoEditsImpl(db, input),
    {
      properties: {
        itemId: input.itemId,
        organizationId: input.organizationId,
      },
    }
  );

export type ApplyBatchItemVideoEditsResult = Awaited<
  ReturnType<typeof applyBatchItemVideoEdits>
>;
