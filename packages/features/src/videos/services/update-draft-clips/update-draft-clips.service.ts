import { randomUUID } from 'node:crypto';
import {
  type VideoDraftClip,
  asset,
  video,
  videoDraftClip,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray } from 'drizzle-orm';

import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type UpdateDraftClipsInput,
  updateDraftClipsSchema,
} from './update-draft-clips.schema.js';

const updateDraftClipsImpl = async (
  db: DbConnection,
  input: UpdateDraftClipsInput
): Promise<Result<{ clips: VideoDraftClip[] }>> => {
  const parsed = updateDraftClipsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { videoId, organizationId, clips } = parsed.data;

  // Cross-org guard on the parent video.
  const [parent] = await db
    .select({ id: video.id, organizationId: video.organizationId })
    .from(video)
    .where(and(eq(video.id, videoId), notDeleted(video)))
    .limit(1);

  if (!parent || parent.organizationId !== organizationId) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Video not found', { videoId })
    );
  }

  // Validate every assetId belongs to the same org BEFORE the DELETE so a
  // bad input can't wipe an existing tray. Empty `clips` is a legitimate
  // "clear the tray" request and skips the asset validation entirely.
  if (clips.length > 0) {
    const assetIds = Array.from(new Set(clips.map((c) => c.assetId)));
    // Explicit .limit(20) terminates the chain — matches the schema cap and
    // keeps the shape symmetric with the parent-video lookup so test mocks
    // can queue both terminals consistently.
    const assetRows = await db
      .select({ id: asset.id, organizationId: asset.organizationId })
      .from(asset)
      .where(and(inArray(asset.id, assetIds), notDeleted(asset)))
      .limit(20);
    const validAssetIds = new Set(
      assetRows
        .filter((a) => a.organizationId === organizationId)
        .map((a) => a.id)
    );
    const missing = assetIds.filter((id) => !validAssetIds.has(id));
    if (missing.length > 0) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'One or more assets not found', {
          missingAssetIds: missing,
        })
      );
    }
  }

  // DELETE-then-INSERT in a single transaction so concurrent reads either
  // see the old tray or the new one — never a half-written state.
  const inserted = await db.transaction(async (tx) => {
    await tx.delete(videoDraftClip).where(eq(videoDraftClip.videoId, videoId));

    if (clips.length === 0) return [];

    return tx
      .insert(videoDraftClip)
      .values(
        clips.map((c) => ({
          id: randomUUID(),
          videoId,
          assetId: c.assetId,
          source: c.source,
          beatOrder: c.beatOrder,
          processingStatus: c.processingStatus,
        }))
      )
      .returning();
  });

  return ok({ clips: inserted });
};

/**
 * Replace a video draft's clip tray (W-C10-clip-tray).
 *
 * Used by the frontend on drag-reorder + ✕-remove paths — the operator's
 * intent is "the tray now looks like this", and the cleanest way to express
 * it through React Query optimistic updates is to PUT the whole array.
 *
 * DELETE-then-INSERT inside a transaction; concurrent reads see either
 * the old tray or the new one. Ids are not preserved across the round-trip
 * (the operator's view doesn't depend on them — `(videoId, beatOrder)` is
 * the natural key from a UX perspective).
 *
 * Empty `clips` clears the tray. Asset cross-org validation runs BEFORE
 * the DELETE so a malformed payload can't wipe a tray.
 */
export const updateDraftClips = (
  db: DbConnection,
  input: UpdateDraftClipsInput
) =>
  trackedResult(
    'videos.updateDraftClips',
    () => withOrgScope((tx) => updateDraftClipsImpl(tx, input), { db }),
    {
      properties: {
        videoId: input.videoId,
        organizationId: input.organizationId,
        clipCount: input.clips.length,
      },
    }
  );

export type UpdateDraftClipsResult = Awaited<
  ReturnType<typeof updateDraftClips>
>;
