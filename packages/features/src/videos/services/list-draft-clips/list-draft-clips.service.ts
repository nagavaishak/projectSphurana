import {
  type VideoDraftClipProcessingStatus,
  type VideoDraftClipSource,
  asset,
  video,
  videoDraftClip,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, asc, eq } from 'drizzle-orm';

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
  type ListDraftClipsInput,
  listDraftClipsSchema,
} from './list-draft-clips.schema.js';

/**
 * Row shape returned to callers. The asset fields are nullable so an in-flight
 * `uploading` row (no asset record yet) still lists cleanly. The factory
 * tool `videos_listDraftClips` re-emits these as JSON to the model; the
 * frontend `<ClipTray>` consumes them via the `useClipTrayState` hook.
 */
export interface DraftClipRow {
  id: string;
  videoId: string;
  assetId: string | null;
  source: VideoDraftClipSource;
  beatOrder: number;
  processingStatus: VideoDraftClipProcessingStatus;
  createdAt: Date;
  updatedAt: Date;
  /** Joined asset metadata when `assetId` is set; null for in-flight uploads. */
  asset: {
    id: string;
    name: string;
    type: string;
    duration: number | null;
    blobUrl: string | null;
    thumbnailUrl: string | null;
    tags: string[];
  } | null;
}

const listDraftClipsImpl = async (
  db: DbConnection,
  input: ListDraftClipsInput
): Promise<Result<{ clips: DraftClipRow[] }>> => {
  const parsed = listDraftClipsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { videoId, organizationId } = parsed.data;

  // Cross-org guard: confirm the video belongs to the caller's org before
  // we read its tray. NOT_FOUND on miss is intentional — a foreign-org id
  // shouldn't reveal that it exists elsewhere.
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

  const rows = await db
    .select({
      id: videoDraftClip.id,
      videoId: videoDraftClip.videoId,
      assetId: videoDraftClip.assetId,
      source: videoDraftClip.source,
      beatOrder: videoDraftClip.beatOrder,
      processingStatus: videoDraftClip.processingStatus,
      createdAt: videoDraftClip.createdAt,
      updatedAt: videoDraftClip.updatedAt,
      assetIdJoined: asset.id,
      assetName: asset.name,
      assetType: asset.type,
      assetDuration: asset.duration,
      assetBlobUrl: asset.blobUrl,
      assetThumbnailUrl: asset.thumbnailUrl,
      assetTags: asset.tags,
    })
    .from(videoDraftClip)
    .leftJoin(
      asset,
      and(eq(videoDraftClip.assetId, asset.id), notDeleted(asset))
    )
    .where(eq(videoDraftClip.videoId, videoId))
    .orderBy(asc(videoDraftClip.beatOrder), asc(videoDraftClip.createdAt));

  const clips: DraftClipRow[] = rows.map((row) => ({
    id: row.id,
    videoId: row.videoId,
    assetId: row.assetId,
    source: row.source,
    beatOrder: row.beatOrder,
    processingStatus: row.processingStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    asset: row.assetIdJoined
      ? {
          id: row.assetIdJoined,
          name: row.assetName ?? '',
          type: row.assetType ?? 'video',
          duration: row.assetDuration ?? null,
          blobUrl: row.assetBlobUrl ?? null,
          thumbnailUrl: row.assetThumbnailUrl ?? null,
          tags: row.assetTags ?? [],
        }
      : null,
  }));

  return ok({ clips });
};

/**
 * List the chat-native tray for a video draft (W-C10-clip-tray).
 *
 * Joins to the asset library so callers get thumbnail/name/tags on `ready`
 * rows without a second round-trip. In-flight `uploading` rows return with
 * `asset: null`. Order is `beatOrder ASC, createdAt ASC` so reorders are
 * deterministic and ties (multiple suggestions at beat 0) keep insertion
 * order.
 *
 * Logs only INTERNAL_ERROR — NOT_FOUND on cross-org access is expected.
 */
export const listDraftClips = (db: DbConnection, input: ListDraftClipsInput) =>
  trackedResult(
    'videos.listDraftClips',
    () => withOrgScope((tx) => listDraftClipsImpl(tx, input), { db }),
    {
      properties: {
        videoId: input.videoId,
        organizationId: input.organizationId,
      },
      internalErrorsOnly: true,
    }
  );

export type ListDraftClipsResult = Awaited<ReturnType<typeof listDraftClips>>;
