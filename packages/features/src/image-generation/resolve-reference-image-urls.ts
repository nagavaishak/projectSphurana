/**
 * Resolve stored `image_template.referenceImageUrls` entries into
 * browser-loadable URLs for the admin preview surfaces (list grid + detail).
 *
 * Stored values are written by the seed/import flow as one of:
 *   - `s3://bucket/key` — when CDN is disabled (local dev). Not loadable by an
 *     `<img>`; presign for GET.
 *   - a private CloudFront URL — when CDN is enabled. Requires CloudFront auth;
 *     sign the URL so the `<img>` loads without signed cookies.
 *   - anything else (already-signed https, public https) — passed through.
 *
 * Read-only: this never mutates the DB. The renderer keeps reading the raw
 * stored values; only the admin read responses get resolved URLs.
 */
import {
  extractKeyFromCdnUrl,
  getPresignedDownloadUrl,
  getSignedCdnUrl,
  isCdnEnabled,
  parseS3Url,
} from '@borradh-workspace/storage';

/** Resolve a single stored reference-image URL into a browser-loadable URL. */
export async function resolveReferenceImageUrl(
  stored: string
): Promise<string> {
  // `s3://bucket/key` — never browser-loadable; presign for GET.
  if (stored.startsWith('s3://')) {
    const withoutScheme = stored.slice('s3://'.length);
    const slash = withoutScheme.indexOf('/');
    if (slash > 0) {
      const bucket = withoutScheme.slice(0, slash);
      const key = withoutScheme.slice(slash + 1);
      return getPresignedDownloadUrl({ bucket, key });
    }
    return stored;
  }

  // Raw S3 https URL (no CDN) — presign with the parsed bucket/key.
  const s3 = parseS3Url(stored);
  if (s3) {
    return getPresignedDownloadUrl({ bucket: s3.bucket, key: s3.key });
  }

  // Private CloudFront URL — sign it (skip if it already carries query params,
  // which means it was signed upstream).
  if (isCdnEnabled()) {
    try {
      const parsed = new URL(stored);
      if (!parsed.search) {
        const key = extractKeyFromCdnUrl(stored);
        if (key) return getSignedCdnUrl(key);
      }
    } catch {
      // Not a parseable URL — fall through to pass-through.
    }
  }

  return stored;
}

/** Resolve every entry of a `referenceImageUrls` array in parallel. */
export async function resolveReferenceImageUrls(
  urls: string[]
): Promise<string[]> {
  return Promise.all(urls.map((url) => resolveReferenceImageUrl(url)));
}
