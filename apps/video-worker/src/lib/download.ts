/**
 * Resilient download helpers for worker asset processing.
 *
 * Source downloads (presigned S3 / CDN URLs) occasionally fail mid-transfer
 * with transient errors — connection resets, socket timeouts (ETIMEDOUT),
 * or 5xx/429 responses from the object store. A single `fetch()` that throws
 * on the first hiccup turns a recoverable blip into a hard worker failure
 * that pages us in Sentry (see ENG-250, ENG-51).
 *
 * These helpers retry transient failures with exponential backoff and
 * surface *permanent* failures (404/403 — the object is gone or
 * inaccessible) as a typed `DownloadError` so callers can downgrade them to
 * a warn instead of a Sentry error.
 */

import * as fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const DEFAULT_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [500, 1500, 4000];

/** Transient network error codes worth retrying. */
const TRANSIENT_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'EAI_AGAIN',
  'ENOTFOUND',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
]);

export class DownloadError extends Error {
  /** HTTP status when the failure was a non-OK response (undefined for network errors). */
  readonly status?: number;
  /** True when retrying could plausibly succeed (network error / 5xx / 429). */
  readonly retryable: boolean;

  constructor(message: string, opts: { status?: number; retryable: boolean }) {
    super(message);
    this.name = 'DownloadError';
    this.status = opts.status;
    this.retryable = opts.retryable;
  }
}

/**
 * True when the error is a permanent "the source object is gone or
 * inaccessible" condition (404/403). These are not worth retrying and are
 * not worth a Sentry error — the asset was deleted, expired, or never
 * existed (e.g. smoke-test fixtures).
 */
export function isMissingAssetError(error: unknown): boolean {
  return (
    error instanceof DownloadError &&
    (error.status === 404 || error.status === 403)
  );
}

function isTransientNetworkError(error: unknown): boolean {
  if (error instanceof DownloadError) return error.retryable;
  // Node fetch wraps the real cause; the code can sit on either level.
  const code = (error as { code?: string })?.code;
  const causeCode = (error as { cause?: { code?: string } })?.cause?.code;
  return (
    (typeof code === 'string' && TRANSIENT_CODES.has(code)) ||
    (typeof causeCode === 'string' && TRANSIENT_CODES.has(causeCode))
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch a URL, retrying transient failures. Resolves with a `Response` whose
 * body is still unread. Throws a `DownloadError` (with `retryable`/`status`)
 * once retries are exhausted or the failure is permanent.
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  attempts = DEFAULT_ATTEMPTS
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;

      const retryable = response.status >= 500 || response.status === 429;
      const error = new DownloadError(
        `Download failed (${response.status}): ${response.statusText}`,
        { status: response.status, retryable }
      );
      // Drain the body so the socket can be reused/closed cleanly.
      await response.body?.cancel().catch(() => {});
      if (!retryable) throw error;
      lastError = error;
    } catch (error) {
      if (error instanceof DownloadError && !error.retryable) throw error;
      if (
        !(error instanceof DownloadError) &&
        !isTransientNetworkError(error)
      ) {
        throw error;
      }
      lastError = error;
    }

    if (attempt < attempts) {
      await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 4000);
    }
  }

  if (lastError instanceof DownloadError) throw lastError;
  throw new DownloadError(
    `Download failed after ${attempts} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
    { retryable: true }
  );
}

/**
 * Download a URL to a local file path, streaming the body and retrying
 * transient failures.
 */
export async function downloadToFile(
  url: string,
  destPath: string,
  attempts = DEFAULT_ATTEMPTS
): Promise<void> {
  const response = await fetchWithRetry(url, undefined, attempts);
  if (!response.body) {
    throw new DownloadError('Download failed: empty response body', {
      retryable: false,
    });
  }
  await pipeline(
    Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
    fs.createWriteStream(destPath)
  );
}
