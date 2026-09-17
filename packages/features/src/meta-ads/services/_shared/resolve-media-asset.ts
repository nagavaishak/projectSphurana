import { asset, graphic, video } from '@borradh-workspace/database';
import { createLogger } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { AdErrorCodes } from '../../models/index.js';

const logger = createLogger('MetaAds');

export interface ResolvedMediaAsset {
  mediaBlobUrl: string;
  mediaTitle: string;
  assetType: 'video' | 'image';
}

/**
 * Resolve media asset for an ad: checks video table first, then asset table,
 * then the graphic table (image creatives).
 *
 * @param db - Database connection
 * @param mediaId - The video, asset, or graphic ID to look up
 * @param fallbackName - Fallback title if the record has no title/name
 */
export const resolveMediaAsset = async (
  db: DbConnection,
  mediaId: string,
  fallbackName: string
): Promise<Result<ResolvedMediaAsset>> => {
  // Check video table first
  const videoRecord = await db.query.video.findFirst({
    where: and(eq(video.id, mediaId), notDeleted(video)),
  });

  if (videoRecord) {
    if (videoRecord.status !== 'ready') {
      return err(
        new FeatureError(
          AdErrorCodes.VIDEO_NOT_READY,
          'Video is still processing. Please wait until it is ready.'
        )
      );
    }

    if (!videoRecord.blobUrl) {
      return err(
        new FeatureError(
          AdErrorCodes.VIDEO_NOT_READY,
          'Video URL not available'
        )
      );
    }

    logger.info('Resolved media from video table', {
      mediaId,
      source: 'video',
    });

    return ok({
      mediaBlobUrl: videoRecord.blobUrl,
      mediaTitle: videoRecord.title || fallbackName,
      assetType: 'video' as const,
    });
  }

  // Fall back to asset table
  const assetRecord = await db.query.asset.findFirst({
    where: and(eq(asset.id, mediaId), notDeleted(asset)),
  });

  if (!assetRecord) {
    // Fall back to the graphic table (image creatives). A graphic's first
    // successful rendered output is the ad image.
    const graphicRecord = await db.query.graphic.findFirst({
      where: eq(graphic.id, mediaId),
      columns: { title: true, status: true, outputs: true },
    });

    if (graphicRecord) {
      if (graphicRecord.status !== 'ready') {
        return err(
          new FeatureError(
            AdErrorCodes.VIDEO_NOT_READY,
            'Graphic is still rendering. Please wait until it is ready.'
          )
        );
      }
      const output = graphicRecord.outputs?.find(
        (o) => (o.status ?? 'success') === 'success' && o.url
      );
      if (!output?.url) {
        return err(
          new FeatureError(
            AdErrorCodes.VIDEO_NOT_READY,
            'Graphic has no rendered image available'
          )
        );
      }

      logger.info('Resolved media from graphic table', {
        mediaId,
        source: 'graphic',
      });

      return ok({
        mediaBlobUrl: output.url,
        mediaTitle: graphicRecord.title || fallbackName,
        assetType: 'image' as const,
      });
    }

    return err(
      new FeatureError(AdErrorCodes.VIDEO_NOT_FOUND, 'Media not found')
    );
  }

  if (!assetRecord.blobUrl) {
    return err(
      new FeatureError(AdErrorCodes.VIDEO_NOT_READY, 'Media URL not available')
    );
  }

  logger.info('Resolved media from asset table', {
    mediaId,
    source: 'asset',
    assetType: assetRecord.type,
  });

  return ok({
    mediaBlobUrl: assetRecord.blobUrl,
    mediaTitle: assetRecord.name || fallbackName,
    assetType: assetRecord.type as 'video' | 'image',
  });
};
