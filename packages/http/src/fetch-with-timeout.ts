/**
 * Timeout-bounded `fetch`.
 *
 * Native `fetch()` has NO default timeout — a slow or dead upstream hangs the
 * caller (a request handler or a worker job) forever. Every outbound HTTP call
 * in this codebase should go through this helper (or {@link fetchWithRetry},
 * which builds on it) so a stuck connection fails fast instead of wedging a
 * process.
 *
 * The timeout is enforced with an `AbortController`. If the caller also passes
 * their own `signal` (e.g. a request-scoped abort), both are honoured: aborting
 * either one aborts the fetch.
 */

import { getFetchInterceptor } from './interceptor.js';

/** Default per-call timeout (15s) — generous for most third-party APIs. */
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

export interface FetchWithTimeoutInit extends RequestInit {
  /** Per-call timeout in ms. Defaults to {@link DEFAULT_FETCH_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/**
 * Redact credential-bearing query params (`access_token`, `appsecret_proof`)
 * from a URL before it lands in an error message / log / Sentry event. Meta
 * Graph calls carry the token in the query string, so an unscrubbed URL in a
 * timeout error leaks a live credential into observability tooling.
 */
export function redactUrlSecrets(url: string): string {
  return url.replace(
    /([?&](?:access_token|appsecret_proof)=)[^&#]+/gi,
    '$1REDACTED'
  );
}

/**
 * Error thrown when a fetch is aborted because it exceeded its timeout.
 *
 * Distinguished from a caller-initiated abort so {@link isTransientHttpError}
 * (and retry logic) can treat a timeout as retryable while leaving a
 * deliberate user/request abort alone.
 */
export class FetchTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly url: string;
  readonly code = 'FETCH_TIMEOUT';

  constructor(url: string, timeoutMs: number) {
    // Scrub credential-bearing query params — this message (and the stored
    // url) flow into logs/Sentry via callers' error handling.
    const redactedUrl = redactUrlSecrets(url);
    super(`Request to ${redactedUrl} timed out after ${timeoutMs}ms`);
    this.name = 'FetchTimeoutError';
    this.url = redactedUrl;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * A promise that rejects once `signal` aborts, so an interceptor that never
 * settles is still bounded by the caller's timeout. Never resolves.
 */
function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    signal.addEventListener('abort', () => reject(new Error('aborted')), {
      once: true,
    });
  });
}

/**
 * `fetch` with a hard timeout. Throws {@link FetchTimeoutError} if the request
 * does not respond within `timeoutMs`.
 */
export async function fetchWithTimeout(
  url: string,
  init: FetchWithTimeoutInit = {}
): Promise<Response> {
  const { timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, signal, ...rest } = init;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  // Forward an externally-supplied abort onto our controller so either source
  // cancels the fetch.
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    // Optional process-wide interceptor (E2E Meta contract fake). Deliberately
    // INSIDE the timeout: a hanging or buggy interceptor must fail like a slow
    // upstream rather than wedging the caller forever, and the fake's
    // timeout-simulation path depends on this producing a real
    // FetchTimeoutError. `null` means "not mine" → fall through to the network.
    const interceptor = getFetchInterceptor();
    if (interceptor) {
      const init = { ...rest, signal: controller.signal };
      const intercepted = await Promise.race([
        interceptor(url, init),
        rejectOnAbort(controller.signal),
      ]);
      if (intercepted) return intercepted;
    }

    return await fetch(url, { ...rest, signal: controller.signal });
  } catch (error) {
    // The fetch rejects with an AbortError when controller.abort() fires. If we
    // were the ones who aborted (timeout), surface a clear, classifiable error.
    if (timedOut) {
      throw new FetchTimeoutError(url, timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}
