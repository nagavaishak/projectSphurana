import { asset, video } from '@borradh-workspace/database';
import { inArray } from 'drizzle-orm';
import type { DbConnection } from '../../../shared/index.js';

/** Everything the ad preview needs about one ad's creative. */
export interface AdPreviewMedia {
  title: string | null;
  /** Playable video, when the creative is a video. */
  videoUrl: string | null;
  /** Poster for a video, or the image itself for an image creative. */
  thumbnailUrl: string | null;
  durationMs: number | null;
  /** Intrinsic size, when known, so the preview frame is right on first paint. */
  width: number | null;
  height: number | null;
}

/**
 * Resolve `metaAd.videoId` for a batch of ads.
 *
 * That column holds EITHER a `video.id` OR an `asset.id` — the schema says so,
 * and `resolveMediaAsset` (the LAUNCH path) has always honoured both. The READ
 * path only ever joined `video`, so an ad built from an uploaded asset found
 * nothing and previewed blank. Measured in production: 42 of 130 ads with a
 * `videoId` pointed at an asset, across 20 organisations, and 12 of those had
 * no Meta thumbnail to fall back on — those previews were simply empty.
 *
 * Batched deliberately: the list route resolves every ad on the page, and a
 * per-ad lookup would be an N+1.
 */
export const loadAdPreviewMediaByMediaId = async (
  db: DbConnection,
  mediaIds: (string | null | undefined)[]
): Promise<Map<string, AdPreviewMedia>> => {
  const ids = [...new Set(mediaIds.filter((id): id is string => Boolean(id)))];
  const out = new Map<string, AdPreviewMedia>();
  if (ids.length === 0) return out;

  const videos = await db.query.video.findMany({
    where: inArray(video.id, ids),
    columns: {
      id: true,
      title: true,
      blobUrl: true,
      thumbnailUrl: true,
      durationMs: true,
    },
  });
  for (const v of videos) {
    out.set(v.id, {
      title: v.title,
      videoUrl: v.blobUrl,
      thumbnailUrl: v.thumbnailUrl,
      durationMs: v.durationMs,
      // The video table does not carry rendered dimensions; the preview
      // measures them from the media instead.
      width: null,
      height: null,
    });
  }

  const remaining = ids.filter((id) => !out.has(id));
  if (remaining.length === 0) return out;

  const assets = await db.query.asset.findMany({
    where: inArray(asset.id, remaining),
    columns: {
      id: true,
      name: true,
      type: true,
      blobUrl: true,
      thumbnailUrl: true,
      transcodedBlobUrl: true,
      transcodeStatus: true,
      duration: true,
      width: true,
      height: true,
      deletedAt: true,
    },
  });
  for (const a of assets) {
    if (a.deletedAt) continue;
    const isVideo = a.type === 'video';
    // Prefer the transcoded copy for playback when there is one: originals can
    // be codecs a browser will not play (the transcode exists for exactly that).
    const playable =
      a.transcodeStatus === 'ready' && a.transcodedBlobUrl
        ? a.transcodedBlobUrl
        : a.blobUrl;
    out.set(a.id, {
      title: a.name ?? null,
      videoUrl: isVideo ? playable : null,
      // An image asset IS its blobUrl; a video asset's still is its thumbnail.
      thumbnailUrl: isVideo ? a.thumbnailUrl : a.blobUrl,
      // `asset.duration` is seconds (a real); the ad shape carries milliseconds.
      durationMs: isVideo && a.duration ? Math.round(a.duration * 1000) : null,
      width: a.width,
      height: a.height,
    });
  }

  return out;
};

/** Single-ad convenience wrapper. */
export const loadAdPreviewMedia = async (
  db: DbConnection,
  mediaId: string | null | undefined
): Promise<AdPreviewMedia | null> => {
  if (!mediaId) return null;
  const map = await loadAdPreviewMediaByMediaId(db, [mediaId]);
  return map.get(mediaId) ?? null;
};
