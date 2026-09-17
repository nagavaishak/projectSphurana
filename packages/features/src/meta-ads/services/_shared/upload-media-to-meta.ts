import type { MetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import { FeatureError, type Result, err, ok } from '../../../shared/index.js';
import { AdErrorCodes } from '../../models/index.js';
import { getFreshDownloadUrl } from './get-fresh-download-url.js';

export interface MediaUploadResult {
  metaVideoId?: string;
  metaImageHash?: string;
  thumbnailUrl?: string;
}

/**
 * Upload media (image or video) to Meta and return the result.
 *
 * For videos, waits for Meta's video encoding to complete.
 * Extracted from finalize-ad and publish-ad where this logic was duplicated.
 */
export const uploadMediaToMeta = async (
  metaService: MetaAdsService,
  input: {
    mediaBlobUrl: string;
    mediaTitle: string;
    assetType: 'video' | 'image';
  }
): Promise<Result<MediaUploadResult>> => {
  const presignedUrl = await getFreshDownloadUrl(input.mediaBlobUrl);

  if (input.assetType === 'image') {
    const imageUpload = await metaService.uploadImage(presignedUrl);
    return ok({ metaImageHash: imageUpload.imageHash });
  }

  // Video path: upload then wait for encoding
  const videoUpload = await metaService.uploadVideo(
    presignedUrl,
    input.mediaTitle
  );

  const videoStatus = await metaService.waitForVideoReady(
    videoUpload.videoId,
    60,
    3000
  );

  if (!videoStatus.isReady) {
    return err(
      new FeatureError(
        AdErrorCodes.META_VIDEO_UPLOAD_FAILED,
        videoStatus.errorMessage ||
          'Video processing timed out on Meta. The video may be too large or in an unsupported format. Please try again or use a shorter video.'
      )
    );
  }

  return ok({
    metaVideoId: videoUpload.videoId,
    thumbnailUrl: videoStatus.thumbnailUrl,
  });
};
