/**
 * Optional outbound-HTTP interceptor.
 *
 * `fetchWithTimeout` is the single chokepoint for outbound HTTP in this
 * codebase (`fetchWithRetry` / `fetchJsonWithRetry` both delegate to it). This
 * module lets a process install ONE function that gets first refusal on every
 * outbound call.
 *
 * The only production consumer today is the E2E Meta contract fake, installed
 * at boot when `META_E2E_STUB=true` on preview / local CI hosts. It matches
 * Graph hosts and serves them from a declared contract so the browser suite can
 * drive ad publishes, social posts and chatbot delivery without touching real
 * Meta.
 *
 * DESIGN NOTES
 * ------------
 * - **Unset by default.** With no interceptor installed this module costs a
 *   single null check per request and changes nothing. Production never
 *   installs one.
 * - **Host-scoping is the interceptor's job, not ours.** The hook offers every
 *   request; returning `null` means "not mine, carry on". That keeps S3, CDN,
 *   Remotion, OpenAI and everything else untouched by a Meta-only fake.
 * - **One interceptor, not a chain.** A chain invites ordering questions and
 *   silent shadowing. If we ever need two, compose them explicitly at the call
 *   site rather than growing a registry here.
 */

/**
 * Given a request, either produce a `Response` (handled) or `null` (pass
 * through to the real network).
 *
 * Throwing propagates to the caller exactly as a network error would — which is
 * how the fake surfaces "unknown Graph endpoint" and request-contract
 * violations as loud, immediate failures rather than confusing downstream
 * timeouts.
 */
export type FetchInterceptor = (
  url: string,
  init: RequestInit
) => Promise<Response | null>;

let interceptor: FetchInterceptor | null = null;

/**
 * Install (or clear, with `null`) the process-wide interceptor.
 *
 * Call this ONCE at boot, before any module has a chance to make a request.
 * Returns the previous interceptor so tests can restore it.
 */
export function setFetchInterceptor(
  next: FetchInterceptor | null
): FetchInterceptor | null {
  const previous = interceptor;
  interceptor = next;
  return previous;
}

/** The currently-installed interceptor, if any. */
export function getFetchInterceptor(): FetchInterceptor | null {
  return interceptor;
}

/** True when an interceptor is installed. Cheap guard for hot paths. */
export function hasFetchInterceptor(): boolean {
  return interceptor !== null;
}
