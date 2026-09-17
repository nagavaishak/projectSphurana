import {
  getOrgAssetsBucket,
  getPresignedDownloadUrl,
  getSignedCdnUrl,
  isCdnEnabled,
} from '@borradh-workspace/storage';
import { Logger } from '@nestjs/common';

const logger = new Logger('FaceGroupUrls');

/**
 * Resolve an S3 key OR a full S3/CDN URL to something the browser can load.
 *
 * Was `FaceGroupsController.resolveUrl`. It looks like the `asset` strategy of
 * `@MediaUrls`, and deliberately is NOT: face THUMBNAILS are persisted as BARE
 * OBJECT KEYS, not URLs, so an unparseable value here must be treated as a key
 * and signed — whereas `resolveAssetUrl` returns an unparseable value verbatim.
 * Collapsing the two would stop every face thumbnail from loading.
 */
export async function resolveFaceMediaUrl(urlOrKey: string): Promise<string> {
  // Extract key — if it's a full S3 URL, parse out the key; otherwise treat as a bare key
  let key: string;
  try {
    const parsed = new URL(urlOrKey);
    key = parsed.pathname.startsWith('/')
      ? parsed.pathname.slice(1)
      : parsed.pathname;
  } catch {
    // Not a URL — treat as a bare S3 key (e.g. face thumbnails)
    key = urlOrKey;
  }

  if (isCdnEnabled()) {
    return getSignedCdnUrl(key);
  }

  try {
    return await getPresignedDownloadUrl({
      bucket: getOrgAssetsBucket(),
      key,
      expiresIn: 3600,
    });
  } catch (error) {
    logger.warn(`Failed to presign key ${key}: ${error}`);
    return urlOrKey;
  }
}

/**
 * Resolve the asset blobUrls in a face-group response.
 *
 * Was `FaceGroupsController.transformGroupUrls`. Response shaping is not a
 * controller's job (Gate 5), and `@MediaUrls` cannot express this one: its
 * dot-path walker has no array segment, and the path is `assets[].asset.blobUrl`.
 */
export async function resolveFaceGroupUrls<
  T extends { assets: Array<{ asset: { blobUrl: string } }> },
>(group: T): Promise<T> {
  const assetUrls = await Promise.all(
    group.assets.map((ga) => resolveFaceMediaUrl(ga.asset.blobUrl))
  );

  return {
    ...group,
    assets: group.assets.map((ga, i) => ({
      ...ga,
      asset: { ...ga.asset, blobUrl: assetUrls[i] },
    })),
  };
}
