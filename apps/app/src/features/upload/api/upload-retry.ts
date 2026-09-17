/**
 * Pure retry/backoff/classification helpers for presigned-URL S3 uploads.
 *
 * Kept free of app imports (api-client, PostHog, React) so they can be
 * unit-tested in isolation — see `upload-retry.test.ts`. The upload
 * orchestration lives in `resumable-upload.ts`.
 */

/** Transient failure (network drop, HTTP 5xx, stall) — retry as-is. */
export class RetryableUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableUploadError';
  }
}

/**
 * The PUT was rejected with 403 — almost always an expired/stale presigned
 * URL (slow uplinks + retries can easily outlive the presign TTL). Retryable,
 * but only after fetching a FRESH presigned URL; retrying the same URL is
 * guaranteed to fail again.
 */
export class StaleUrlUploadError extends RetryableUploadError {
  constructor(message: string) {
    super(message);
    this.name = 'StaleUrlUploadError';
  }
}

/**
 * Map a non-2xx HTTP status from an S3 PUT to the right error subtype:
 * - 403 → stale/expired presigned URL → retry with a refreshed URL
 * - 5xx → transient S3-side failure → retry as-is
 * - other 4xx → permanent (bad content-type, missing key, ...) → don't retry
 */
export function classifyUploadHttpFailure(status: number): Error {
  if (status === 403) {
    return new StaleUrlUploadError(
      'Upload rejected with 403 (presigned URL likely expired)'
    );
  }
  if (status >= 500) {
    return new RetryableUploadError(`Upload failed with status ${status}`);
  }
  return new Error(`Upload failed with status ${status}`);
}

export function isRetryableUploadError(error: unknown): boolean {
  // fetch()/XHR network failures surface as TypeError in some paths.
  return error instanceof RetryableUploadError || error instanceof TypeError;
}

/** True when the next retry must fetch a fresh presigned URL first. */
export function needsFreshUrl(error: unknown): boolean {
  return error instanceof StaleUrlUploadError;
}

/**
 * Full-jitter backoff: random in [0, base] for the given 1-indexed attempt.
 * Spreads retries across the window so a short connectivity drop doesn't
 * consume every attempt at once, and bursts of clients de-synchronize.
 */
export function backoffWithJitter(
  attempt: number,
  baseDelays: number[]
): number {
  const base =
    baseDelays[attempt - 1] ?? baseDelays[baseDelays.length - 1] ?? 4000;
  return Math.round(Math.random() * base);
}

/** Refresh presigned URLs this many seconds before they actually expire. */
export const PRESIGN_REFRESH_MARGIN_SECONDS = 60;

/**
 * Whether a cached presigned URL is too close to expiry to trust for a new
 * PUT attempt. `expiresIn` is the TTL in seconds reported by the presign
 * endpoint; we refresh once within {@link PRESIGN_REFRESH_MARGIN_SECONDS} of
 * expiry so a long upload doesn't start against a URL that dies mid-flight.
 */
export function shouldRefreshPresignedUrl(
  issuedAtMs: number,
  expiresInSeconds: number,
  nowMs: number = Date.now()
): boolean {
  const usableMs =
    Math.max(0, expiresInSeconds - PRESIGN_REFRESH_MARGIN_SECONDS) * 1000;
  return nowMs >= issuedAtMs + usableMs;
}
