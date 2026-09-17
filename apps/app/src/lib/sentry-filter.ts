/**
 * Client-side Sentry noise filter.
 *
 * The browser reports plenty of things that are not defects: a user declining a
 * permission prompt, a session ageing out, a crypto wallet extension failing to
 * inject, a laptop losing wifi mid-request. Each one used to reach Sentry, and
 * because the production alert rule fires on `First seen event` with no
 * threshold, each one minted its own Linear ticket. Eleven of the tickets
 * closed on 2026-07-30 were exactly this.
 *
 * The predicate is deliberately a pure function so it can be unit-tested — the
 * cost of a bad rule here is silence, so it needs to be as narrow as possible
 * and proven not to swallow real errors.
 */

/** Extension protocols. Nothing we ship runs from these origins. */
const EXTENSION_ORIGIN = /^(chrome|moz|safari-web)-extension:\/\//i;

/**
 * Third-party wallet/extension injection. `Failed to connect to MetaMask`
 * comes from an injected provider script, not from our bundle.
 */
const EXTENSION_NOISE = /failed to connect to metamask|ethereum provider/i;

/**
 * Expected, user-driven conditions. These are already surfaced to the user in
 * the UI (a re-login prompt, an upgrade prompt, a permission re-request) — the
 * Sentry copy adds nothing.
 */
const EXPECTED_USER_CONDITION =
  /invalid or expired session|a paid plan is required|the request is not allowed by the user agent/i;

/**
 * Client connectivity. A dropped request tells us about ONE browser's network,
 * not about the API.
 *
 * NOTE: this deliberately relies on uptime monitoring being the outage
 * detector. If the API is genuinely down, every client emits `Failed to fetch`
 * — and dropping those here means Sentry will NOT show it. That is the correct
 * division of labour (BetterStack monitors `/health`), but it is load-bearing:
 * if uptime monitoring is ever removed, this rule must go with it.
 */
const CLIENT_NETWORK =
  /failed to fetch|load failed|networkerror when attempting to fetch|fetch is aborted|the operation was aborted/i;

/**
 * ENG-853: browser/host quirks that are not our code, but are not extension
 * injection or client connectivity either — a third-party runtime behaviour
 * we happen to observe, never cause, and cannot fix.
 *
 * Each pattern is anchored to the EXACT phrase (not a loose substring) so this
 * cannot accidentally swallow a real error that merely mentions "ResizeObserver"
 * or "postMessage".
 */
const RESIZE_OBSERVER_NOISE =
  /^ResizeObserver loop (completed with undelivered notifications\.?|limit exceeded)$/i;

/**
 * Safari/Chrome autofill & password-manager inline-suggestion overlay failing
 * to render its own UI. The message names a browser-owned feature; nothing in
 * our bundle calls it.
 */
const INLINE_SUGGESTIONS_NOISE = /^Failed to get inline suggestions$/i;

/**
 * Meta's in-app browser (Facebook/Instagram WebView on Android) postMessage
 * bridge tearing down mid-call. Only reachable from that host's WebView, not
 * from our code.
 */
const FB_INAPP_BRIDGE_NOISE =
  /^Error invoking postMessage: Java object is gone$/i;

export interface SentryEventLike {
  exception?: {
    values?: Array<{
      type?: string;
      value?: string;
      stacktrace?: { frames?: Array<{ filename?: string }> };
    }>;
  };
  message?: string;
}

/** The single reason an event was dropped, for logging/telemetry. Null = keep. */
export type DropReason =
  | 'browser-extension'
  | 'expected-user-condition'
  | 'client-network'
  | 'browser-quirk';

/**
 * Should this event be discarded before it reaches Sentry?
 *
 * Returns the reason (useful for a local console breadcrumb) or null to keep.
 */
export function classifyDroppableEvent(
  event: SentryEventLike
): DropReason | null {
  const values = event.exception?.values ?? [];
  const text = [event.message, ...values.map((v) => v.value)]
    .filter(Boolean)
    .join(' ');

  // A frame from an extension origin means the error did not originate in our
  // code, whatever it says.
  const fromExtension = values.some((v) =>
    v.stacktrace?.frames?.some(
      (f) => f.filename && EXTENSION_ORIGIN.test(f.filename)
    )
  );
  if (fromExtension || EXTENSION_NOISE.test(text)) return 'browser-extension';

  if (
    RESIZE_OBSERVER_NOISE.test(text) ||
    INLINE_SUGGESTIONS_NOISE.test(text) ||
    FB_INAPP_BRIDGE_NOISE.test(text)
  ) {
    return 'browser-quirk';
  }

  if (EXPECTED_USER_CONDITION.test(text)) return 'expected-user-condition';
  if (CLIENT_NETWORK.test(text)) return 'client-network';

  return null;
}
