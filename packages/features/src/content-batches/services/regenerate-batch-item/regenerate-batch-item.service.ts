/**
 * `regenerateBatchItem` — re-roll one post in a monthly batch.
 *
 * Appends a new attempt to the slot and points the slot at it. The post keeps
 * its id, its decision, its schedule and its conversation; only the cut
 * changes.
 *
 * Flow (both kinds):
 *   1. Load the slot + its current attempt, org-scoped (`loadPendingSlotForOrg`).
 *   2. Count the slot's existing cuts — the next attempt takes that number, and
 *      the unique index on (slot_id, attempt_number) is what stops two
 *      concurrent presses from both claiming it.
 *   3. Produce the new asset — delegated:
 *        graphics → `regenerateGraphic`  (inserts the placeholder, enqueues)
 *        videos   → `planVideoDetail`    (also appends the attempt itself)
 *   4. Graphics only: append the attempt and move the pointer, in one
 *      transaction guarded on the slot still being `pending`.
 *
 * NEITHER branch owns rendering. That is the point of this file being ~350
 * lines shorter than it was: "re-roll a graphic" and "re-roll a video" each
 * have exactly one implementation, and this service is the part that knows
 * about slots.
 */

import { randomUUID } from 'node:crypto';
import {
  type ContentAttempt,
  type ContentItem,
  type VideoDraftConfig,
  contentAttempt,
  contentBatch,
  contentItem,
  video,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { regenerateGraphic } from '../../../graphics/services/regenerate-graphic/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { planVideoDetail } from '../../../videos/services/plan-video-detail/index.js';
import { loadPendingSlotForOrg } from '../_shared/index.js';
import { settleBatchStatus } from '../settle-batch-status/index.js';
import {
  type RegenerateBatchItemInput,
  regenerateBatchItemSchema,
} from './regenerate-batch-item.schema.js';

export interface RegenerateBatchItemResponse {
  /**
   * The SLOT — unchanged by a re-roll.
   *
   * This used to be the id of a freshly minted replacement row, and the client
   * had to follow it: the post it was looking at effectively became a different
   * post, taking its thread and its identity with it. A regenerate now appends
   * a cut to the post that was already there, so the id the caller passed in is
   * the id it gets back.
   */
  id: string;
  batchId: string;
  position: number;
  regenerationCount: number;
  /** The newly appended cut, and its place in the slot's history. */
  attemptId: string;
  attemptNumber: number;
  /** Set for graphic re-rolls — the new placeholder graphic to poll. */
  graphicId?: string;
  /** Set for video re-rolls — the new video to poll for export. */
  videoId?: string;
  /** Pass-through so callers can return the whole row to the client. */
  item: ContentItem;
}

/**
 * Map an organic variationId to the draft-config block key that holds its
 * generated copy, so a re-roll can feed the previous copy back into the
 * generator (refinement-aware regeneration). Mirrors `organicCopyToConfigBlock`.
 */
const VARIATION_DRAFT_KEY: Record<string, keyof VideoDraftConfig> = {
  'caption-tease-1': 'captionTease',
  'fade-benefits-1': 'fadeBenefits',
  'aesthetic-line-1': 'aestheticLine',
  'numbered-list-1': 'numberedList',
  'ins-outs-1': 'insOuts',
  'question-cta-1': 'questionCta',
  'improves-1': 'improves',
};

function extractPriorOrganicCopy(
  draftConfig: VideoDraftConfig | null,
  variationId: string
): Record<string, unknown> | undefined {
  if (!draftConfig) return undefined;
  const key = VARIATION_DRAFT_KEY[variationId];
  if (!key) return undefined;
  const block = draftConfig[key];
  return block && typeof block === 'object'
    ? (block as unknown as Record<string, unknown>)
    : undefined;
}

/**
 * Video re-roll: regenerate on-screen copy from the previous draft applying the
 * user's instruction, then re-render via `planVideoDetail` (which inserts the
 * replacement content_batch_item with supersession + queues the export). The
 * original's caption / schedule / pages / idea are reused so the re-roll only
 * changes the video copy, mirroring the graphic path.
 */
async function regenerateVideoItem(
  db: DbConnection,
  args: {
    original: ContentItem;
    currentAttempt: ContentAttempt;
    attemptCount: number;
    organizationId: string;
    createdById: string;
    periodMonth: string;
    refinementInstruction?: string;
    /** Narrowed by the caller — this path only serves monthly-plan slots. */
    batchId: string;
    position: number;
  }
): Promise<Result<RegenerateBatchItemResponse>> {
  const {
    original,
    currentAttempt,
    organizationId,
    createdById,
    periodMonth,
    batchId,
    position,
  } = args;
  if (!currentAttempt.videoId) {
    return err(
      new FeatureError(ErrorCodes.INVALID_STATE, 'Item has no associated video')
    );
  }

  const sourceVideo = await db.query.video.findFirst({
    where: and(
      eq(video.id, currentAttempt.videoId),
      eq(video.organizationId, organizationId),
      notDeleted(video)
    ),
  });
  if (!sourceVideo) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Source video not found')
    );
  }
  if (!sourceVideo.serviceId) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'Source video has no service to regenerate from'
      )
    );
  }
  if (!sourceVideo.templateId || !sourceVideo.variationId) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'Source video is missing a template/variation to regenerate from'
      )
    );
  }

  const priorCopy = extractPriorOrganicCopy(
    sourceVideo.draftConfig,
    sourceVideo.variationId
  );

  // The clips the previous render actually used, in order.
  //
  // Carrying these is what makes a copy edit an EDIT. Selection is a
  // least-recently-used claim that STAMPS as it claims, so the original render
  // pushed its own clips to the back of the queue — re-claiming is not merely
  // free to pick different footage, it is steered away from what was just
  // used. "Make the headline shorter" returned a different video.
  const priorClipAssetIds =
    sourceVideo.draftConfig?.bRollClips
      ?.slice()
      .sort((a, b) => a.order - b.order)
      .map((c) => c.assetId)
      .filter((id): id is string => Boolean(id)) ?? [];

  const planResult = await planVideoDetail(db, {
    organizationId,
    createdById,
    batchId,
    periodMonth,
    targetServiceId: sourceVideo.serviceId,
    // Carried-through label only (not fed into the idea prompt). Reuse the
    // original's caption/title so it stays meaningful on a re-roll.
    topicSummary:
      currentAttempt.caption ?? sourceVideo.title ?? 'Regenerated video',
    position,
    scheduledAt: original.scheduledAt ?? new Date(),
    templateId: sourceVideo.templateId,
    variationId: sourceVideo.variationId,
    targetPageIds: original.targetPageIds ?? [],
    regeneration: {
      slotId: original.id,
      attemptNumber: args.attemptCount,
      regenerationCount: original.regenerationCount + 1,
      refinementInstruction: args.refinementInstruction,
      priorCopy,
      reuseCaption: currentAttempt.caption,
      reuseVideoIdea:
        (original.videoIdea as Record<string, unknown> | null) ?? null,
      // Declared, not inferred. This entry point IS the review-dialog copy
      // edit — the user typed an instruction about the words — so it states
      // `copy` rather than leaving the planner to guess from the shape of the
      // arguments. A future "different footage" action states `footage`.
      intent: 'copy',
      ...(priorClipAssetIds.length ? { priorClipAssetIds } : {}),
    },
  });
  if (!planResult.success) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        `Failed to regenerate video: ${planResult.error.message}`
      )
    );
  }
  const { itemId: slotId, videoId: newVideoId } = planResult.data;

  // No supersession bookkeeping left to do. `planVideoDetail` appended the cut
  // and moved the slot's pointer in one transaction, so there is no replacement
  // row to mark, no original to flip to a terminal status, and no
  // delete-the-orphan path for when that flip loses a race. That block was
  // roughly forty lines and three failure modes; the pointer is one write.
  const slot = await db.query.contentItem.findFirst({
    where: eq(contentItem.id, slotId),
  });
  if (!slot?.currentAttemptId) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Slot not found after appending the new cut'
      )
    );
  }

  return ok({
    id: slot.id,
    batchId,
    position,
    regenerationCount: slot.regenerationCount,
    attemptId: slot.currentAttemptId,
    attemptNumber: args.attemptCount,
    videoId: newVideoId,
    item: slot,
  });
}

const regenerateBatchItemImpl = async (
  db: DbConnection,
  input: RegenerateBatchItemInput
): Promise<Result<RegenerateBatchItemResponse>> => {
  const parsed = regenerateBatchItemSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { itemId, organizationId, createdById, reason, slideIndex, edits } =
    parsed.data;

  // Normalise the confirm-a-proposal shape and the press-the-button shape into
  // one, at the boundary — same move `regenerateGraphic` makes for its two
  // per-slide inputs, and for the same reason: everything below should see one
  // representation rather than two kept in step by hand.
  const targetedEdits = edits
    ?.filter(
      (
        edit
      ): edit is {
        slideIndex: number;
        op: 'refine' | 'remove';
        note?: string;
      } => edit.slideIndex !== null
    )
    .map((edit) => ({
      slideIndex: edit.slideIndex,
      op: edit.op,
      ...(edit.note ? { note: edit.note } : {}),
    }));
  // The instruction for a whole-asset re-roll: an explicit `reason`, or the
  // note(s) from a whole-asset proposal.
  const wholeAssetNote =
    reason ??
    (edits && !targetedEdits?.length
      ? edits
          .map((edit) => edit.note)
          .filter((note): note is string => Boolean(note))
          .join(' ')
      : undefined);

  // ── 1. Load + ownership check ─────────────────────────────────────────
  const loaded = await loadPendingSlotForOrg(db, { itemId, organizationId });
  if (!loaded.success) return err(loaded.error);
  const { slot: original, attempt: currentAttempt } = loaded.data;

  // Both of these are non-null for a slot that belongs to a monthly plan, and
  // this service only ever operates on one — it appends a cut to a BATCH slot
  // and moves that slot's pointer. Narrowing here, once, keeps the guarantee
  // out of the wire contract and off every line below, and turns a standalone
  // slot arriving on this path into a clear refusal rather than a null
  // spreading through the response.
  if (original.batchId === null || original.position === null) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'This post is not part of a monthly plan',
        { itemId }
      )
    );
  }
  const batchId = original.batchId;
  const position = original.position;

  const [batchRow] = await withOrgScope(
    (tx) =>
      tx
        .select({ periodMonth: contentBatch.periodMonth })
        .from(contentBatch)
        .where(eq(contentBatch.id, batchId))
        .limit(1),
    { db }
  );

  // How many cuts this slot already has. The next one takes this number, and
  // the unique index on (slot_id, attempt_number) is what stops two concurrent
  // presses from both claiming it — the loser gets a constraint violation
  // rather than a silently mangled history.
  const attemptCount = (
    await withOrgScope(
      (tx) =>
        tx
          .select({ id: contentAttempt.id })
          .from(contentAttempt)
          .where(eq(contentAttempt.slotId, original.id)),
      { db }
    )
  ).length;

  // No cap. `regenerationCount` is still incremented and still surfaced, so
  // the spend stays visible — it just no longer refuses. A hard stop at three
  // punished the case it was aimed at: someone who cares enough to keep trying
  // is the owner most likely to ship something good, and telling them "no more"
  // leaves them with the version they had already rejected.

  // ── Video items: re-roll via planVideoDetail (refinement-aware) ───────
  if (original.kind === 'video') {
    return regenerateVideoItem(db, {
      original,
      currentAttempt,
      attemptCount,
      organizationId,
      createdById,
      periodMonth: batchRow?.periodMonth ?? '',
      refinementInstruction: wholeAssetNote,
      batchId,
      position,
    });
  }

  if (!currentAttempt.graphicId) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'Item has no associated graphic'
      )
    );
  }

  // ── 3. Render the replacement graphic ─────────────────────────────────
  //
  // Delegated, not re-implemented. This used to be ~120 lines that loaded the
  // source graphic, resolved the org's brand primary, inserted a placeholder
  // with the template pinned, and enqueued a render-only job — the same
  // procedure `regenerateGraphic` performs for the create-post modal and the
  // onboarding ad-picker, written a second time.
  //
  // It had already drifted, and not harmlessly: the copy passed NO anchor for a
  // whole-carousel re-roll, so "make the headline shorter" on a batch carousel
  // replanned the deck from the inspiration image instead of amending what was
  // there. Delegating fixes that, and picks up prior-copy carry-through,
  // `regenerationIntent`, `usageType`/`offerId` and source-asset swaps for free.
  //
  // Everything below this call is the part that IS about a batch: appending the
  // cut and moving the slot's pointer.
  const rendered = await regenerateGraphic(db, {
    organizationId,
    createdById,
    graphicId: currentAttempt.graphicId,
    contentBatchId: batchId,
    scope: slideIndex !== undefined ? 'slide' : 'all',
    ...(slideIndex !== undefined ? { slideIndex } : {}),
    ...(targetedEdits?.length ? { slideEdits: targetedEdits } : {}),
    ...(wholeAssetNote ? { refinementInstruction: wholeAssetNote } : {}),
    // Stated by the thread. Without it the shim guesses from the wording, and
    // guesses `copy` for a logo request — which pins the very thing being asked
    // to change.
    ...(edits?.find((edit) => edit.intent)?.intent
      ? {
          regenerationIntent: edits.find((edit) => edit.intent)?.intent as
            | 'copy'
            | 'image'
            | 'branding'
            | 'full',
        }
      : {}),
  });
  if (!rendered.success) {
    // `trackedResult` widens the error to a plain shape on the way out, so it
    // has to be rebuilt to cross a service boundary. Same rewrap
    // `regenerateAdCandidate` does for the same call.
    return err(
      new FeatureError(
        rendered.error.code,
        rendered.error.message,
        rendered.error.details
      )
    );
  }
  const newGraphicId = rendered.data.id;

  // ── 4. Append the new cut and point the slot at it ────────────────────
  //
  // One transaction, and far less of it than before. This used to insert a
  // whole replacement `content_batch_item` copying the original's caption,
  // schedule, pages and idea across, then flip the original to 'regenerated',
  // then — if that flip lost a race with an accept — delete both new rows again
  // to unwind. Three statements, two failure paths, and a post that changed its
  // own id under the client.
  //
  // Now: insert an attempt, move the pointer. The slot's decision, schedule,
  // pages, idea and conversation are untouched because they were never part of
  // the cut. The `reviewStatus = 'pending'` guard on the pointer move is the
  // same race guard as before, but losing it now unwinds by doing nothing —
  // the attempt is inserted inside the same transaction, so it rolls back.
  const newAttemptId = randomUUID();
  let newItem: ContentItem;
  try {
    const slotRow = await withOrgScope(
      (tx) =>
        (tx as DbConnection).transaction(async (trx) => {
          await trx.insert(contentAttempt).values({
            id: newAttemptId,
            organizationId: original.organizationId,
            slotId: original.id,
            batchId: original.batchId,
            attemptNumber: attemptCount,
            graphicId: newGraphicId,
            videoId: null,
            // The words carry across a re-roll of the image: the owner may have
            // edited them, and a graphic re-roll changes the picture, not the
            // post. (A video re-roll regenerates copy, which is why that path
            // does not do this.)
            caption: currentAttempt.caption,
            regenerationReason:
              wholeAssetNote ??
              targetedEdits
                ?.map((e) =>
                  e.op === 'remove'
                    ? `removed slide ${e.slideIndex + 1}`
                    : `slide ${e.slideIndex + 1}: ${e.note}`
                )
                .join('; ') ??
              null,
          });

          const [updated] = await trx
            .update(contentItem)
            .set({
              currentAttemptId: newAttemptId,
              regenerationCount: original.regenerationCount + 1,
              // The proposal has now been spent — clear it so the confirm
              // button does not linger over a cut that already applied it.
              pendingRegenerate: null,
            })
            .where(
              and(
                eq(contentItem.id, original.id),
                eq(contentItem.reviewStatus, 'pending')
              )
            )
            .returning();

          if (!updated) {
            // Someone accepted while the render was being prepared. Throwing
            // rolls back the attempt insert too, which is the whole reason both
            // are in here.
            throw new FeatureError(
              ErrorCodes.CONFLICT,
              'Concurrent update — this post is no longer pending'
            );
          }
          return updated;
        }),
      { db }
    );
    newItem = slotRow;
  } catch (error) {
    // The replacement graphic is NOT deleted here, unlike before.
    //
    // The render is already enqueued by this point — the order changed when the
    // render moved into `regenerateGraphic`, which inserts and enqueues
    // together. Deleting the row now would leave a running worker writing its
    // outputs to a graphic that no longer exists. The row is orphaned instead:
    // it finishes rendering and sits in the library unreferenced, which is the
    // cost of losing a race that needs a concurrent accept in another tab.
    if (error instanceof FeatureError) return err(error);
    logError('contentBatches.regenerateBatchItem.appendAttempt', error, {
      feature: 'content-batches',
      extra: { itemId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to append the regenerated cut'
      )
    );
  }

  // A re-roll puts this slot back into rendering, so the batch is no longer
  // reviewable. Settling in BOTH directions is what keeps the stored status
  // from drifting: a one-way "it's done now" flag would be wrong the moment
  // an owner regenerated anything.
  await settleBatchStatus(db, { batchId });

  return ok({
    id: newItem.id,
    batchId,
    position,
    regenerationCount: newItem.regenerationCount,
    attemptId: newAttemptId,
    attemptNumber: attemptCount,
    graphicId: newGraphicId,
    item: newItem,
  });
};

export const regenerateBatchItem = (
  db: DbConnection,
  input: RegenerateBatchItemInput
) =>
  trackedResult(
    'contentBatches.regenerateBatchItem',
    () => regenerateBatchItemImpl(db, input),
    {
      properties: {
        itemId: input.itemId,
        organizationId: input.organizationId,
      },
    }
  );

export type RegenerateBatchItemResult = Awaited<
  ReturnType<typeof regenerateBatchItem>
>;
