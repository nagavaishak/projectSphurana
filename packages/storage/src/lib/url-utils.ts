/**
 * Parse an S3 URL and extract bucket and key components.
 * Supports both virtual-hosted style and path style URLs.
 *
 * @example
 * // Virtual-hosted style
 * parseS3Url('https://bucket.s3.region.amazonaws.com/key/path')
 * // => { bucket: 'bucket', key: 'key/path' }
 *
 * // Path style
 * parseS3Url('https://s3.region.amazonaws.com/bucket/key/path')
 * // => { bucket: 'bucket', key: 'key/path' }
 */
export function parseS3Url(
  url: string
): { bucket: string; key: string } | null {
  try {
    const parsed = new URL(url);

    // Virtual-hosted style: bucket.s3.region.amazonaws.com/key
    // Also handles region-less: bucket.s3.amazonaws.com/key
    const virtualHostedMatch = parsed.hostname.match(
      /^([^.]+)\.s3(?:[.-]([^.]+))?\.amazonaws\.com$/
    );
    if (virtualHostedMatch) {
      return {
        bucket: virtualHostedMatch[1],
        key: parsed.pathname.slice(1),
      };
    }

    // Path style: s3.region.amazonaws.com/bucket/key
    const pathStyleMatch = parsed.hostname.match(
      /^s3[.-]([^.]+)\.amazonaws\.com$/
    );
    if (pathStyleMatch) {
      const pathParts = parsed.pathname.slice(1).split('/');
      const bucket = pathParts[0];
      const key = pathParts.slice(1).join('/');
      return { bucket, key };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract the S3 key from a CDN URL.
 * CDN URLs have the format: https://cdn.example.com/{key}
 *
 * @returns The S3 key or null if the URL is not a valid CDN URL
 */
export function extractKeyFromCdnUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const key = parsed.pathname.slice(1); // Remove leading /
    return key || null;
  } catch {
    return null;
  }
}

/**
 * Resolve a CDN URL back to the bucket it is served from, and the real key
 * within that bucket.
 *
 * `getPublicCdnUrl` publishes public objects as `${CDN_URL}/public/${key}` —
 * the `public/` segment is a CDN ROUTING PREFIX, not part of the S3 key. So a
 * CDN URL cannot be turned back into an S3 location by stripping the leading
 * slash alone: doing that keeps `public/` in the key AND leaves the caller
 * guessing at the bucket.
 *
 * That guess was wrong. Both presign sites in the video worker defaulted every
 * unparseable URL to the ORG bucket, so a stock clip stored at
 * `public-assets/stock-footage/x.mp4` was fetched as
 * `org-assets/public/stock-footage/x.mp4` — wrong bucket and wrong key — and
 * every render using stock footage failed with a 404.
 *
 * Returns the SCOPE rather than a bucket name so this module stays free of the
 * env-backed bucket helpers; callers map scope to bucket.
 */
export function parseCdnUrl(
  url: string
): { scope: 'public' | 'org'; key: string } | null {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\/+/, '');
    if (!path) return null;

    if (path === 'public' || path.startsWith('public/')) {
      const key = path.slice('public/'.length);
      return key ? { scope: 'public', key } : null;
    }

    return { scope: 'org', key: path };
  } catch {
    return null;
  }
}
