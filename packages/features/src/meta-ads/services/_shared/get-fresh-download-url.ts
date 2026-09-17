import { createLogger } from '@borradh-workspace/observability';
import {
  getOrgAssetsBucket,
  getPresignedDownloadUrl,
  parseS3Url,
} from '@borradh-workspace/storage';

const logger = createLogger('MetaAds');

/**
 * Generate a fresh presigned download URL from a stored blob URL.
 *
 * Stored blob URLs are CDN or S3 URLs — this extracts the S3 key
 * and generates a fresh presigned URL that Meta can fetch directly.
 * Falls back to the original URL on error.
 */
export const getFreshDownloadUrl = async (blobUrl: string): Promise<string> => {
  try {
    const url = new URL(blobUrl);

    // Parse the actual bucket and key from the URL (handles S3 virtual-hosted
    // and path-style URLs). Falls back to org-assets bucket + pathname for
    // CDN or non-S3 URLs.
    const s3Info = parseS3Url(blobUrl);
    const bucket = s3Info?.bucket ?? getOrgAssetsBucket();
    const key =
      s3Info?.key ??
      (url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname);

    logger.info('Generating presigned URL for Meta media upload', {
      originalHost: url.hostname,
      s3Key: key,
      bucket,
    });
    const presignedUrl = await getPresignedDownloadUrl({
      bucket,
      key,
      expiresIn: 3600,
    });
    logger.info('Presigned URL generated successfully', {
      urlLength: presignedUrl.length,
      urlHost: new URL(presignedUrl).hostname,
    });
    return presignedUrl;
  } catch (error) {
    logger.error('Failed to generate presigned URL, falling back to original', {
      blobUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return blobUrl;
  }
};
