import {
  graphic,
  metaAd,
  video,
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
import { AdErrorCodes } from '../../models/index.js';
import { loadAdPreviewMedia } from '../_shared/index.js';
import { type GetAdInput, getAdSchema } from './get-ad.schema.js';

/**
 * Internal implementation
 */
const getAdImpl = async (
  db: DbConnection,
  input: GetAdInput
): Promise<
  Result<
    typeof metaAd.$inferSelect & {
      video:
        | (Partial<typeof video.$inferSelect> & {
            /** Set only for asset-backed creatives, which store their size. */
            width?: number | null;
            height?: number | null;
          })
        | undefined;
      graphicImageUrl: string | null;
      graphicImageKey: string | null;
      graphicImageWidth: number | null;
      graphicImageHeight: number | null;
    }
  >
> => {
  // Validate input
  const parsed = getAdSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { adId, organizationId } = parsed.data;

  // Get ad
  const ad = await db.query.metaAd.findFirst({
    where: eq(metaAd.id, adId),
  });

  if (!ad) {
    return err(new FeatureError(AdErrorCodes.AD_NOT_FOUND, 'Ad not found'));
  }

  // Verify organization access directly on the ad
  if (ad.organizationId !== organizationId) {
    return err(new FeatureError(AdErrorCodes.AD_NOT_FOUND, 'Ad not found'));
  }

  // Get video details (videoId may be null for imported ads)
  const videoRecord = ad.videoId
    ? await db.query.video.findFirst({
        where: and(eq(video.id, ad.videoId), notDeleted(video)),
      })
    : undefined;

  // `videoId` can point at an ASSET rather than a video — the launch path has
  // always honoured both (`resolveMediaAsset`). Without this, an ad built from
  // an uploaded asset has no creative to preview.
  const assetMedia = videoRecord
    ? null
    : await loadAdPreviewMedia(db, ad.videoId);

  // Get the rendered image for graphic (image) ads so the UI can show the
  // full-res creative. Controller signs the URL/key for browser access.
  const graphicRecord = ad.graphicId
    ? await db.query.graphic.findFirst({
        where: eq(graphic.id, ad.graphicId),
        columns: { outputs: true },
      })
    : undefined;
  const graphicFirstOutput = graphicRecord?.outputs?.[0] ?? null;

  // Present an asset-backed creative in the same shape the route already
  // returns for a video, so nothing downstream has to know the difference.
  const previewVideo =
    videoRecord ??
    (assetMedia
      ? {
          id: ad.videoId as string,
          title: assetMedia.title ?? ad.name,
          blobUrl: assetMedia.videoUrl,
          thumbnailUrl: assetMedia.thumbnailUrl,
          durationMs: assetMedia.durationMs,
          width: assetMedia.width,
          height: assetMedia.height,
        }
      : undefined);

  return ok({
    ...ad,
    video: previewVideo || undefined,
    graphicImageUrl: graphicFirstOutput?.url ?? null,
    graphicImageKey: graphicFirstOutput?.objectKey ?? null,
    // Intrinsic size, so the preview frame is the right shape on first paint
    // instead of snapping once the image loads.
    graphicImageWidth: graphicFirstOutput?.width ?? null,
    graphicImageHeight: graphicFirstOutput?.height ?? null,
  });
};

/**
 * Get a Meta ad by ID with its video
 */
export const getAd = (db: DbConnection, input: GetAdInput) =>
  trackedResult(
    'metaAds.getAd',
    () => withOrgScope((tx) => getAdImpl(tx, input), { db }),
    {
      properties: { adId: input.adId },
      internalErrorsOnly: true,
    }
  );

/**
 * Result type for getAd
 */
export type GetAdResult = Awaited<ReturnType<typeof getAd>>;
