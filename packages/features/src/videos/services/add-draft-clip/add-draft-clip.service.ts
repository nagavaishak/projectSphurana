import { randomUUID } from 'node:crypto';
import {
  type VideoDraftClip,
  asset,
  video,
  videoDraftClip,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';

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
  type AddDraftClipInput,
  addDraftClipSchema,
} from './add-draft-clip.schema.js';

const addDraftClipImpl = async (
  db: DbConnection,
  input: AddDraftClipInput
): Promise<Result<VideoDraftClip>> => {
  const parsed = addDraftClipSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    videoId,
    organizationId,
    assetId,
    source,
    beatOrder,
    processingStatus,
  } = parsed.data;

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

  // Cross-org guard on the asset (a foreign-org assetId is more interesting
  // than a foreign-org videoId — operators sometimes paste IDs from other
  // tabs). If the asset doesn't belong to the same org, refuse the link
  // rather than letting the FK guard surface a confusing error.
  const [parentAsset] = await db
    .select({ id: asset.id, organizationId: asset.organizationId })
    .from(asset)
    .where(and(eq(asset.id, assetId), notDeleted(asset)))
    .limit(1);

  if (!parentAsset || parentAsset.organizationId !== organizationId) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Asset not found', { assetId })
    );
  }

  const [row] = await db
    .insert(videoDraftClip)
    .values({
      id: randomUUID(),
      videoId,
      assetId,
      source,
      beatOrder: beatOrder ?? 0,
      processingStatus,
    })
    .returning();

  return ok(row);
};

/**
 * Append one row to a video draft's clip tray (W-C10-clip-tray).
 *
 * Callers:
 *   - frontend upload-completion handler — called once per dropped clip
 *     after the asset row exists and the analysis job is queued.
 *   - `videos_autoSelectClips` (one call per suggestion) after the model
 *     picks N clips to fill empty beats.
 *
 * Cross-org isolation: both the parent video and the asset must belong to
 * the same `organizationId`. The latter check is belt-and-braces — the FK
 * cascade would catch it eventually, but a clear NOT_FOUND beats a `pg`
 * error message bubbling to Claire.
 */
export const addDraftClip = (db: DbConnection, input: AddDraftClipInput) =>
  trackedResult(
    'videos.addDraftClip',
    () => withOrgScope((tx) => addDraftClipImpl(tx, input), { db }),
    {
      properties: {
        videoId: input.videoId,
        organizationId: input.organizationId,
        assetId: input.assetId,
        source: input.source,
      },
    }
  );

export type AddDraftClipResult = Awaited<ReturnType<typeof addDraftClip>>;
