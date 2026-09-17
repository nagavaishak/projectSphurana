/**
 * Content-addressed store for curated stock footage clips.
 *
 * Mirrors the image-template reference store: clip bytes live in the per-env
 * ORG-ASSETS bucket under a `stock-footage/<vertical>/<sha256>.mp4` key, so the
 * render worker reads/presigns them with its existing per-env credentials in
 * every environment (exactly how user-uploaded b-roll is read). The object key
 * IS the content hash, so re-seeding identical bytes is an idempotent no-op and
 * the objects are immutable.
 *
 * The clip is the source of truth in a curated source folder + descriptions
 * manifest (version-controlled); the seed (`scripts/seed-stock-footage.ts`)
 * uploads bytes here and upserts the catalog row. See
 * docs/implementations/stock-footage-library.md.
 */
import { createHash } from 'node:crypto';
import {
  getOrgAssetsBucket,
  getPresignedDownloadUrl,
  getS3Region,
  upload,
} from '@borradh-workspace/storage';

const KEY_PREFIX = 'stock-footage';

/** sha256 (hex) of a clip's bytes — its content address. */
export function stockClipSha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Canonical object key: `stock-footage/<vertical>/<sha256>.<ext>`. */
export function stockClipKey(
  vertical: string,
  sha256: string,
  ext = 'mp4'
): string {
  return `${KEY_PREFIX}/${vertical}/${sha256}.${ext}`;
}

/**
 * Virtual-hosted S3 URL for a stock clip object. This is the SAME format
 * uploaded org assets store (`https://<bucket>.s3.<region>.amazonaws.com/<key>`)
 * so `parseS3Url` / `presignS3UrlIfNeeded` in the worker resolve it unchanged.
 */
export function stockClipObjectUrl(key: string): string {
  return `https://${getOrgAssetsBucket()}.s3.${getS3Region()}.amazonaws.com/${key}`;
}

/** A presigned GET URL for a stock clip (previews / admin curation surface). */
export function stockClipSignedUrl(key: string): Promise<string> {
  return getPresignedDownloadUrl({ bucket: getOrgAssetsBucket(), key });
}

/**
 * Content-address a clip and upload it to the org-assets bucket. Idempotent:
 * the key is the content hash, so re-publishing identical bytes overwrites the
 * same object. Returns the key + the stored object URL.
 */
export async function publishStockClip(
  vertical: string,
  bytes: Buffer,
  opts?: { ext?: string; contentType?: string }
): Promise<{ key: string; url: string; sha256: string }> {
  const sha256 = stockClipSha256(bytes);
  const ext = opts?.ext ?? 'mp4';
  const key = stockClipKey(vertical, sha256, ext);
  await upload({
    bucket: getOrgAssetsBucket(),
    key,
    body: bytes,
    contentType: opts?.contentType ?? 'video/mp4',
  });
  return { key, url: stockClipObjectUrl(key), sha256 };
}
