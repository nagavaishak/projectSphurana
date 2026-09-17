import { getSignedCookies, getSignedUrl } from '@aws-sdk/cloudfront-signer';
import { storageEnv } from '@borradh-workspace/env/storage';

/**
 * CloudFront Signed Cookies Result
 * These three cookies must be set for CloudFront to grant access
 */
export interface SignedCookiesResult {
  'CloudFront-Policy': string;
  'CloudFront-Signature': string;
  'CloudFront-Key-Pair-Id': string;
}

/**
 * Options for generating signed cookies
 */
export interface SignedCookieOptions {
  /** Organization ID - used to scope access to organization's assets */
  organizationId: string;
  /** Cookie expiration in seconds (default: 3600 = 1 hour) */
  expiresIn?: number;
  /** Optional IP address restriction (e.g., '192.0.2.0/24') */
  ipAddress?: string;
}

/**
 * Check if CloudFront CDN is enabled and configured
 */
export function isCdnEnabled(): boolean {
  return (
    storageEnv.CDN_ENABLED === true &&
    !!storageEnv.CDN_URL &&
    !!storageEnv.CLOUDFRONT_KEY_PAIR_ID &&
    !!storageEnv.CLOUDFRONT_PRIVATE_KEY
  );
}

/**
 * Get the CDN URL from environment
 */
export function getCdnUrl(): string | undefined {
  return storageEnv.CDN_URL;
}

/**
 * Generate signed cookies for CloudFront private content access
 *
 * Uses a custom policy to scope access to the organization's assets only.
 * The policy allows access to: {CDN_URL}/<organizationId>/*
 *
 * @param options - Signed cookie generation options
 * @returns CloudFront signed cookies object
 * @throws Error if CDN is not properly configured
 *
 * @example
 * ```ts
 * const cookies = await generateSignedCookies({
 *   organizationId: 'org-123',
 *   expiresIn: 3600, // 1 hour
 * });
 *
 * // Set cookies in response
 * res.cookie('CloudFront-Policy', cookies['CloudFront-Policy'], cookieOptions);
 * res.cookie('CloudFront-Signature', cookies['CloudFront-Signature'], cookieOptions);
 * res.cookie('CloudFront-Key-Pair-Id', cookies['CloudFront-Key-Pair-Id'], cookieOptions);
 * ```
 */
export function generateSignedCookies(
  options: SignedCookieOptions
): SignedCookiesResult {
  const { organizationId, expiresIn = 3600, ipAddress } = options;

  if (!isCdnEnabled()) {
    throw new Error(
      'CloudFront CDN is not configured. Ensure CDN_ENABLED, CDN_URL, CLOUDFRONT_KEY_PAIR_ID, and CLOUDFRONT_PRIVATE_KEY are set.'
    );
  }

  const cdnUrl = storageEnv.CDN_URL as string;
  const keyPairId = storageEnv.CLOUDFRONT_KEY_PAIR_ID as string;
  // Convert \n strings to actual newlines (for .env files that escape newlines)
  const privateKey = (storageEnv.CLOUDFRONT_PRIVATE_KEY as string).replace(
    /\\n/g,
    '\n'
  );

  // Resource URL with wildcard for organization's private assets
  // Allows access to: https://cdn.domain.com/{orgId}/*
  const resourceUrl = `${cdnUrl}/${organizationId}/*`;

  // Calculate expiration timestamp
  const expirationTime = Math.floor(Date.now() / 1000) + expiresIn;

  // Build custom policy
  const policy: {
    Statement: Array<{
      Resource: string;
      Condition: {
        DateLessThan: { 'AWS:EpochTime': number };
        IpAddress?: { 'AWS:SourceIp': string };
      };
    }>;
  } = {
    Statement: [
      {
        Resource: resourceUrl,
        Condition: {
          DateLessThan: { 'AWS:EpochTime': expirationTime },
        },
      },
    ],
  };

  // Add IP restriction if provided
  if (ipAddress) {
    policy.Statement[0].Condition.IpAddress = { 'AWS:SourceIp': ipAddress };
  }

  // Generate signed cookies using AWS SDK
  const signedCookies = getSignedCookies({
    keyPairId,
    privateKey,
    policy: JSON.stringify(policy),
  });

  return signedCookies as SignedCookiesResult;
}

/**
 * Get CDN URL for a private asset
 *
 * Constructs the full CDN URL for an asset stored in the org-assets bucket.
 * The key should include the organization ID prefix.
 *
 * @param key - S3 object key (should include orgId prefix, e.g., 'org-123/videos/user/file.mp4')
 * @returns Full CDN URL for the asset
 *
 * @example
 * ```ts
 * const url = getPrivateCdnUrl('org-123/videos/user-456/video.mp4');
 * // Returns: https://cdn.staging.domain.com/org-123/videos/user-456/video.mp4
 * ```
 */
export function getPrivateCdnUrl(key: string): string {
  const cdnUrl = storageEnv.CDN_URL;
  if (!cdnUrl) {
    throw new Error('CDN_URL is not configured');
  }
  // Remove leading slash if present
  const cleanKey = key.startsWith('/') ? key.slice(1) : key;
  return `${cdnUrl}/${cleanKey}`;
}

/**
 * Generate a CloudFront signed URL for a private asset.
 *
 * Unlike signed cookies (which require a browser), a signed URL embeds
 * authentication in the URL itself. Use this when the consumer is an
 * external service (e.g., Meta/Instagram) that cannot carry cookies.
 *
 * @param key - S3 object key (e.g., 'org-123/videos/user-456/video.mp4')
 * @param expiresIn - Expiration in seconds (default: 3600 = 1 hour)
 * @returns Signed CloudFront URL
 */
export function getSignedCdnUrl(key: string, expiresIn = 3600): string {
  if (!isCdnEnabled()) {
    throw new Error(
      'CloudFront CDN is not configured. Ensure CDN_ENABLED, CDN_URL, CLOUDFRONT_KEY_PAIR_ID, and CLOUDFRONT_PRIVATE_KEY are set.'
    );
  }

  const cdnUrl = storageEnv.CDN_URL as string;
  const keyPairId = storageEnv.CLOUDFRONT_KEY_PAIR_ID as string;
  const privateKey = (storageEnv.CLOUDFRONT_PRIVATE_KEY as string).replace(
    /\\n/g,
    '\n'
  );

  const cleanKey = key.startsWith('/') ? key.slice(1) : key;
  const resourceUrl = `${cdnUrl}/${cleanKey}`;

  const dateLessThan = new Date(Date.now() + expiresIn * 1000).toISOString();

  return getSignedUrl({
    url: resourceUrl,
    keyPairId,
    privateKey,
    dateLessThan,
  });
}

/**
 * Get CDN URL for a public asset
 *
 * Constructs the full CDN URL for an asset stored in the public-assets bucket.
 * Public assets are served from the /public/ path prefix.
 *
 * @param key - S3 object key (without public/ prefix)
 * @returns Full CDN URL for the public asset
 *
 * @example
 * ```ts
 * const url = getPublicCdnUrl('images/user-456/profile.jpg');
 * // Returns: https://cdn.staging.domain.com/public/images/user-456/profile.jpg
 * ```
 */
export function getPublicCdnUrl(key: string): string {
  const cdnUrl = storageEnv.CDN_URL;
  if (!cdnUrl) {
    throw new Error('CDN_URL is not configured');
  }
  // Remove leading slash if present
  const cleanKey = key.startsWith('/') ? key.slice(1) : key;
  return `${cdnUrl}/public/${cleanKey}`;
}

/**
 * Extract organization ID from a CDN URL or S3 key
 *
 * @param urlOrKey - CDN URL or S3 key
 * @returns Organization ID or null if not found
 *
 * @example
 * ```ts
 * extractOrgIdFromKey('org-123/videos/file.mp4'); // Returns: 'org-123'
 * extractOrgIdFromKey('https://cdn.domain.com/org-123/videos/file.mp4'); // Returns: 'org-123'
 * ```
 */
export function extractOrgIdFromKey(urlOrKey: string): string | null {
  // If it's a URL, extract the path
  let path = urlOrKey;
  if (urlOrKey.startsWith('http')) {
    try {
      const url = new URL(urlOrKey);
      path = url.pathname;
    } catch {
      return null;
    }
  }

  // Remove leading slash
  path = path.startsWith('/') ? path.slice(1) : path;

  // Skip 'public/' prefix for public assets
  if (path.startsWith('public/')) {
    return null; // Public assets don't have org IDs
  }

  // The first segment should be the org ID
  const segments = path.split('/');
  if (segments.length > 0 && segments[0]) {
    return segments[0];
  }

  return null;
}
