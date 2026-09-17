import {
  getCdnUrl,
  getOrgAssetsBucket,
  getPresignedDownloadUrl,
  getSignedCdnUrl,
  isCdnEnabled,
  parseS3Url,
} from '@borradh-workspace/storage';
import { Logger } from '@nestjs/common';
import type { MediaUrlStrategy } from '../decorators/media-urls.decorator.js';

/**
 * The media URL resolution rules, lifted VERBATIM out of three controllers:
 *
 *   AssetsController.getAssetUrl / extractS3Key   → {@link resolveAssetUrl}
 *   MetaAdsController.resolveMediaUrl             → {@link resolveMediaUrl}
 *   MetaAdsController.resolveGraphicUrl           → {@link resolveGraphicUrl}
 *   SocialPostsController.resignCdnUrl            → {@link resignCdnUrl}
 *
 * They are deliberately kept as four separate functions: they disagree about
 * which bucket to presign against and about what to do with a URL that is
 * neither ours nor S3, and each disagreement is load-bearing (see the
 * characterization suites in `apps/api/src/_integration/`).
 *
 * INVARIANTS every branch below must keep:
 *  - an unparseable URL comes back VERBATIM, never throws;
 *  - a Meta `fbcdn.net` URL comes back byte-for-byte, query string included;
 *  - the object key (URL path) survives whichever branch signs it;
 *  - null in → null out.
 */
const logger = new Logger('MediaUrlResolver');

/** `new URL(u).pathname` minus the leading slash; null when unparseable/empty. */
function pathKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    const key = parsed.pathname.startsWith('/')
      ? parsed.pathname.slice(1)
      : parsed.pathname;
    return key || null;
  } catch {
    return null;
  }
}

/**
 * Asset URLs: the object key is the URL PATH, regardless of which bucket host
 * the URL happens to name (assets stored under an older bucket must still
 * resolve). CDN when enabled, presigned S3 otherwise or when forced.
 *
 * `forcePresigned` bypasses the CDN for native media players (iOS AVPlayer,
 * expo-av) which cannot carry CloudFront signed cookies.
 */
export async function resolveAssetUrl(
  blobUrl: string,
  forcePresigned = false
): Promise<string> {
  const key = pathKey(blobUrl);
  if (!key) return blobUrl;

  if (isCdnEnabled() && !forcePresigned) return getSignedCdnUrl(key);

  try {
    return await getPresignedDownloadUrl({
      bucket: getOrgAssetsBucket(),
      key,
      expiresIn: 3600,
    });
  } catch (error) {
    logger.warn(`Failed to generate presigned URL for key ${key}: ${error}`);
    return blobUrl;
  }
}

/**
 * Video / thumbnail URLs (was `VideosController.getVideoUrl`).
 *
 * Differs from {@link resolveAssetUrl} in one load-bearing way: a URL that
 * parses as S3 is presigned against ITS OWN bucket, because rendered videos
 * live in the Remotion output bucket rather than org-assets, and only reaches
 * the CDN when it is already an org-assets object. Everything else falls back
 * to the `asset` rule (URL path is the key, org-assets bucket).
 *
 * `forcePresigned` bypasses the CDN for native media players.
 */
export async function resolveVideoUrl(
  blobUrl: string,
  forcePresigned = false
): Promise<string> {
  // Try parsing as S3 URL first (handles both raw and presigned S3 URLs)
  const s3Info = parseS3Url(blobUrl);
  if (s3Info) {
    if (!forcePresigned && isCdnEnabled()) {
      // Only use CDN for files in the org-assets bucket
      if (s3Info.bucket === getOrgAssetsBucket()) {
        return getSignedCdnUrl(s3Info.key);
      }
    }
    // Presign with the ORIGINAL bucket — not always org-assets
    try {
      return await getPresignedDownloadUrl({
        bucket: s3Info.bucket,
        key: s3Info.key,
        expiresIn: 3600,
      });
    } catch (error) {
      logger.warn(
        `Failed to presign S3 URL (bucket=${s3Info.bucket}, key=${s3Info.key}): ${error}`
      );
      return blobUrl;
    }
  }

  // Not an S3 URL — assume CDN URL, extract key from path
  try {
    const url = new URL(blobUrl);
    const key = url.pathname.startsWith('/')
      ? url.pathname.slice(1)
      : url.pathname;
    if (!key) return blobUrl;

    if (!forcePresigned && isCdnEnabled()) {
      return getSignedCdnUrl(key);
    }

    return await getPresignedDownloadUrl({
      bucket: getOrgAssetsBucket(),
      key,
      expiresIn: 3600,
    });
  } catch (error) {
    logger.warn(`Failed to generate presigned URL for ${blobUrl}: ${error}`);
    return blobUrl;
  }
}

/**
 * Ad media URLs. Videos/assets are stored as already-CDN URLs; private
 * CloudFront needs a signature, so re-sign from the key rather than handing back
 * a bare (unsigned → 403) URL. A URL that is neither under our CDN base nor
 * parseable as S3 — notably Meta's own fbcdn URLs, already signed by Meta — is
 * returned EXACTLY as stored.
 */
export async function resolveMediaUrl(url: string): Promise<string> {
  const cdnBase = getCdnUrl();
  if (isCdnEnabled() && cdnBase && url.startsWith(cdnBase)) {
    const key = url.slice(cdnBase.length).replace(/^\//, '').split('?')[0];
    if (key) return getSignedCdnUrl(key);
  }

  const s3Info = parseS3Url(url);
  if (s3Info) {
    if (isCdnEnabled() && s3Info.bucket === getOrgAssetsBucket()) {
      return getSignedCdnUrl(s3Info.key);
    }
    try {
      return await getPresignedDownloadUrl({
        bucket: s3Info.bucket,
        key: s3Info.key,
        expiresIn: 3600,
      });
    } catch {
      return url;
    }
  }
  return url;
}

/**
 * Rendered-graphic outputs: prefer a signed CDN URL built from the stored object
 * key (graphics live behind private CloudFront); fall back to presigning the
 * stored URL.
 */
export async function resolveGraphicUrl(
  url: string | null | undefined,
  key: string | null | undefined
): Promise<string | null> {
  if (isCdnEnabled() && key) return getSignedCdnUrl(key);
  if (url) return resolveMediaUrl(url);
  return null;
}

/**
 * Social-post media: stored URLs were captured as short-lived signed CloudFront
 * URLs when the post was created, so they decay and previews fall back to a
 * placeholder. Re-sign URLs that point at OUR CDN on read; leave everything else
 * — including unparseable strings — untouched.
 */
export function resignCdnUrl(url: string | null): string | null {
  if (!url || !isCdnEnabled()) return url;
  const cdnUrl = getCdnUrl();
  if (!cdnUrl) return url;
  try {
    const parsed = new URL(url);
    if (parsed.origin !== new URL(cdnUrl).origin) return url;
    const key = parsed.pathname.replace(/^\/+/, '');
    return key ? getSignedCdnUrl(key) : url;
  } catch {
    return url;
  }
}

/** Apply the named strategy to one value. Null/undefined in → same out. */
export async function applyStrategy(
  strategy: MediaUrlStrategy,
  value: unknown,
  opts: { forcePresigned?: boolean; key?: unknown } = {}
): Promise<unknown> {
  if (strategy === 'blank') return null;

  if (strategy === 'graphic') {
    return resolveGraphicUrl(
      typeof value === 'string' ? value : null,
      typeof opts.key === 'string' ? opts.key : null
    );
  }

  if (strategy === 'cdn') {
    return resignCdnUrl(typeof value === 'string' ? value : null) ?? value;
  }

  // `asset` / `media` never received a non-string in the controllers: every
  // call site guarded with a ternary. Keep that guard here.
  if (typeof value !== 'string') return value;

  if (strategy === 'video') return resolveVideoUrl(value, opts.forcePresigned);

  return strategy === 'asset'
    ? resolveAssetUrl(value, opts.forcePresigned)
    : resolveMediaUrl(value);
}
