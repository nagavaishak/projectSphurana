/**
 * Timeout-bounded `fetch` with transient-failure retry.
 *
 * Builds on {@link fetchWithTimeout}: every attempt has its own hard timeout,
 * and the call is retried — with exponential backoff + jitter — on the failures
 * that are genuinely transient:
 *
 *   - network-level errors (connection reset/refused, DNS, socket hang-up),
 *   - a per-attempt timeout,
 *   - retryable HTTP statuses (429 + 5xx, by default).
 *
 * It does NOT retry on 4xx (other than 429) — those are caller/permission
 * errors that won't get better by trying again. A `Retry-After` header on a 429
 * is honoured (capped) so we don't hammer a rate-limited upstream.
 *
 * The function returns the `Response` (it does not throw on a non-ok status the
 * caller might want to inspect); it only throws when the final attempt errors at
 * the network level or times out.
 */
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  FetchTimeoutError,
  type FetchWithTimeoutInit,
  fetchWithTimeout,
  redactUrlSecrets,
} from './fetch-with-timeout.js';

/** Node/undici socket error codes that mean the connection failed transiently. */
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'ENETUNREACH',
  'ENETDOWN',
  'EHOSTUNREACH',
  'EAI_AGAIN', // transient DNS failure
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

const TRANSIENT_MESSAGE =
  /timed out|timeout|socket hang ?up|network|connection (?:reset|refused|closed|terminated)|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i;

/**
 * HTTP statuses worth retrying: rate limiting (429) + server-side failures
 * (500/502/503/504). 501 (not implemented) and 505 are excluded — they won't
 * recover on retry.
 */
export const DEFAULT_RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * Is this thrown error a transient network failure that's safe to retry?
 *
 * Inspects the error and its `cause` (undici wraps the underlying socket error
 * on `error.cause`). A {@link FetchTimeoutError} is always transient; a plain
 * caller-initiated `AbortError` is NOT (the caller asked to stop).
 */
export function isTransientHttpError(error: unknown): boolean {
  if (error instanceof FetchTimeoutError) return true;

  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const code = (candidate as { code?: unknown }).code;
    if (typeof code === 'string' && TRANSIENT_NETWORK_CODES.has(code)) {
      return true;
    }
    const name = (candidate as { name?: unknown }).name;
    // A bare AbortError with no timeout marker is a deliberate caller abort —
    // FetchTimeoutError is handled above, so anything else named AbortError is
    // not retryable.
    if (name === 'AbortError') return false;
    const message = (candidate as { message?: unknown }).message;
    if (typeof message === 'string' && TRANSIENT_MESSAGE.test(message)) {
      return true;
    }
  }
  return false;
}

export interface FetchWithRetryInit extends FetchWithTimeoutInit {
  /** Max retries AFTER the initial attempt (default 2 → up to 3 calls). */
  retries?: number;
  /** HTTP statuses to retry. Defaults to {@link DEFAULT_RETRYABLE_STATUSES}. */
  retryableStatuses?: ReadonlySet<number>;
  /** Base delay for the first backoff, ms (default 500). */
  minDelayMs?: number;
  /** Cap for any single backoff, ms (default 8000). */
  maxDelayMs?: number;
  /** Honour a `Retry-After` header on 429/503 responses (default true). */
  respectRetryAfter?: boolean;
  /** Observability hook fired before each retry sleep. */
  onRetry?: (info: {
    attempt: number;
    delayMs: number;
    status?: number;
    error?: unknown;
  }) => void;
}

/** Parse a `Retry-After` header (delta-seconds or HTTP-date) into ms. */
function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - nowMs);
  return null;
}

/** Exponential backoff with jitter over the upper half of the window. */
function backoff(
  attempt: number,
  minDelayMs: number,
  maxDelayMs: number
): number {
  const ceiling = Math.min(maxDelayMs, minDelayMs * 2 ** attempt);
  return Math.floor(ceiling / 2 + Math.random() * (ceiling / 2));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `fetch` with a per-attempt timeout and transient-failure retry. See the
 * module docstring for the exact retry policy.
 */
export async function fetchWithRetry(
  url: string,
  init: FetchWithRetryInit = {}
): Promise<Response> {
  const {
    retries = 2,
    retryableStatuses = DEFAULT_RETRYABLE_STATUSES,
    minDelayMs = 500,
    maxDelayMs = 8000,
    respectRetryAfter = true,
    onRetry,
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
    ...fetchInit
  } = init;

  let attempt = 0;
  for (;;) {
    const hasRetry = attempt < retries;
    try {
      const response = await fetchWithTimeout(url, { ...fetchInit, timeoutMs });

      if (hasRetry && retryableStatuses.has(response.status)) {
        let delayMs = backoff(attempt, minDelayMs, maxDelayMs);
        if (respectRetryAfter) {
          const retryAfter = parseRetryAfter(
            response.headers.get('retry-after'),
            Date.now()
          );
          // Use the larger of backoff vs Retry-After, but never exceed the cap.
          if (retryAfter !== null) {
            delayMs = Math.min(maxDelayMs, Math.max(delayMs, retryAfter));
          }
        }
        // Discard the body so the connection can be reused.
        await response.body?.cancel().catch(() => {});
        attempt += 1;
        onRetry?.({ attempt, delayMs, status: response.status });
        await sleep(delayMs);
        continue;
      }

      return response;
    } catch (error) {
      if (!hasRetry || !isTransientHttpError(error)) throw error;
      const delayMs = backoff(attempt, minDelayMs, maxDelayMs);
      attempt += 1;
      onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
}

/**
 * Convenience wrapper: {@link fetchWithRetry} that throws on a non-ok final
 * response, returning the parsed JSON body. Useful for the many integration
 * `request()` helpers that already expect "throw on failure, else JSON".
 */
export async function fetchJsonWithRetry<T>(
  url: string,
  init: FetchWithRetryInit & {
    /** Build the error thrown on a non-ok response. */
    onError?: (response: Response, bodyText: string) => Error;
  } = {}
): Promise<T> {
  const { onError, ...retryInit } = init;
  const response = await fetchWithRetry(url, retryInit);
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    if (onError) throw onError(response, bodyText);
    // Scrub credential-bearing query params (access_token, …) from the URL
    // before it lands in the error message / logs / Sentry.
    throw new Error(
      `HTTP ${response.status} ${response.statusText} from ${redactUrlSecrets(url)}${
        bodyText ? `: ${bodyText.slice(0, 500)}` : ''
      }`
    );
  }
  return (await response.json()) as T;
}
