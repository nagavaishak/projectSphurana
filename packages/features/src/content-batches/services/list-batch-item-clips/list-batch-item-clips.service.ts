import {
  asset,
  video as videoTable,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq, inArray } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { loadSlotForOrg } from '../_shared/index.js';
import {
  hasStagedEdits,
  parsePendingVideoEdits,
} from '../handle-review-turn/video-edits.js';
import {
  type BatchItemClip,
  type ListBatchItemClipsInput,
  type ListBatchItemClipsResponse,
  listBatchItemClipsSchema,
} from './list-batch-item-clips.schema.js';

/**
 * The clips behind one video post, in order, with any staged edit marked.
 *
 * Reads `draftConfig.bRollClips` — the list the render actually uses and the
 * one `clipOperations` address. NOT `video_draft_clip`: that table is the
 * editor's own tray, and batch-generated videos have no rows in it, so a review
 * surface reading it showed "no clips" over every post in the batch. The two
 * models of a clip list are the trap here; this one follows the render.
 *
 * Staged edits are returned alongside rather than applied to the list, so the
 * owner sees the current cut with the pending change marked on it — not a
 * preview of a video that does not exist yet.
 */
const listBatchItemClipsImpl = async (
  db: DbConnection,
  input: ListBatchItemClipsInput
): Promise<Result<ListBatchItemClipsResponse>> => {
  const parsed = listBatchItemClipsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { itemId, organizationId } = parsed.data;

  try {
    const loaded = await loadSlotForOrg(db, { itemId, organizationId });
    if (!loaded.success) return err(loaded.error);

    const { slot, attempt } = loaded.data;

    // Staged edits and the render count belong to the CUT, so they come off the
    // attempt. Going back to a previous cut therefore leaves its own staged
    // edits — and its own render tally — exactly where they were.
    const edits = parsePendingVideoEdits(attempt.pendingVideoEdits);
    const relist = edits.clipOperations.find(
      (op): op is { op: 'replace-all'; assetIds: string[] } =>
        op.op === 'replace-all'
    );
    const empty: ListBatchItemClipsResponse = {
      clips: [],
      pendingRelist: Boolean(relist),
      textChanges: Object.keys(edits.patch).length
        ? ['On-screen text change staged']
        : [],
      hasStagedEdits: hasStagedEdits(edits),
      renderCount: attempt.editRenderCount,
      attemptId: attempt.id,
    };

    if (slot.kind !== 'video' || !attempt.videoId) return ok(empty);

    const [videoRow] = await withOrgScope(
      (tx) =>
        tx
          .select({ draftConfig: videoTable.draftConfig })
          .from(videoTable)
          .where(eq(videoTable.id, attempt.videoId as string))
          .limit(1),
      { db }
    );

    const bRollClips = (videoRow?.draftConfig?.bRollClips ?? [])
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const storedAssetIds = bRollClips.map((clip) => clip.assetId);
    // A relist can ADD footage that is not in the stored cut, so the metadata
    // read has to cover both lists — otherwise a clip the owner just dragged in
    // renders as "Untitled clip" with no thumbnail, which reads as broken.
    const shownAssetIds = relist?.assetIds ?? storedAssetIds;
    const assetIds = [...new Set([...storedAssetIds, ...shownAssetIds])];
    if (assetIds.length === 0) return ok(empty);

    const assetRows = await withOrgScope(
      (tx) =>
        tx
          .select({
            id: asset.id,
            name: asset.name,
            thumbnailUrl: asset.thumbnailUrl,
            blobUrl: asset.blobUrl,
            duration: asset.duration,
          })
          .from(asset)
          .where(inArray(asset.id, assetIds)),
      { db }
    );
    const byId = new Map(assetRows.map((a) => [a.id, a]));

    const stagedByIndex = new Map<number, 'remove' | 'swap'>();
    for (const op of edits.clipOperations) {
      if (op.op === 'replace-all') continue;
      stagedByIndex.set(op.index, op.op);
    }
    const inStoredCut = new Set(storedAssetIds);

    const clips: BatchItemClip[] = shownAssetIds.map((assetId, index) => {
      const meta = byId.get(assetId);
      return {
        assetId,
        name: meta?.name ?? 'Untitled clip',
        thumbnailUrl: meta?.thumbnailUrl ?? null,
        blobUrl: meta?.blobUrl ?? null,
        // `duration` is numeric in the DB, which drizzle hands back as a string
        // to keep the precision it was stored with. The card wants a number.
        duration:
          meta?.duration === null || meta?.duration === undefined
            ? null
            : Number(meta.duration),
        clipNumber: index + 1,
        staged: relist
          ? inStoredCut.has(assetId)
            ? null
            : 'added'
          : (stagedByIndex.get(index) ?? null),
      };
    });

    return ok({ ...empty, clips });
  } catch (error) {
    logError('contentBatches.listBatchItemClips', error, {
      feature: 'content-batches',
      extra: { itemId, organizationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to load the clips')
    );
  }
};

export const listBatchItemClips = (
  db: DbConnection,
  input: ListBatchItemClipsInput
) =>
  trackedResult(
    'contentBatches.listBatchItemClips',
    () => listBatchItemClipsImpl(db, input),
    {
      properties: {
        itemId: input.itemId,
        organizationId: input.organizationId,
      },
      internalErrorsOnly: true,
    }
  );

export type ListBatchItemClipsResult = Awaited<
  ReturnType<typeof listBatchItemClips>
>;
