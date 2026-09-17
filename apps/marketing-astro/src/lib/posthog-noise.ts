import type { BeforeSendFn, CaptureResult } from 'posthog-js';

/**
 * ENG-853: apply the same PostHog Error Tracking noise filter apps/app uses,
 * here in the marketing site.
 *
 * This is a DELIBERATE DUPLICATE of
 * `apps/app/src/lib/sentry-filter.ts` + `apps/app/src/lib/posthog-noise-filter.ts`,
 * not a shared import. apps/app and apps/marketing-astro share no browser-safe
 * "utils" package today — `@borradh-workspace/web-shared` (the one package
 * both apps depend on) is scoped to booking/microsite domain logic, and
 * standing up a new shared home + rebuilding its `dist/` output was judged
 * more risk than this feature warrants. If a third app ever needs the same
 * rules, that's the trigger to extract a real shared package; until then keep
 * this file's rules in sync with apps/app's by hand.
 *
 * Unlike apps/app, marketing-astro runs with `capture_exceptions: true`
 * (posthog-js's own autocapture) and has no `reportUnhandledToPostHog`
 * wrapper — so there is no re-wrapping bug here to fix, only the missing
 * noise filter. The `Error invoking postMessage: Java object is gone` event
 * (Meta's Android in-app browser bridge) that this ticket found on the
 * marketing site came from exactly that gap.
 */

/** Extension protocols. Nothing we ship runs from these origins. */
const EXTENSION_ORIGIN = /^(chrome|moz|safari-web)-extension:\/\//i;

/**
 * Third-party wallet/extension injection. `Failed to connect to MetaMask`
 * comes from an injected provider script, not from our bundle.
 */
const EXTENSION_NOISE = /failed to connect to metamask|ethereum provider/i;

/**
 * Expected, user-driven conditions already surfaced to the user in the UI.
 */
const EXPECTED_USER_CONDITION =
  /invalid or expired session|a paid plan is required|the request is not allowed by the user agent/i;

/**
 * Client connectivity. A dropped request tells us about ONE browser's
 * network, not about the site.
 */
const CLIENT_NETWORK =
  /failed to fetch|load failed|networkerror when attempting to fetch|fetch is aborted|the operation was aborted/i;

/**
 * Browser/host quirks that are not our code, not extension injection, and not
 * client connectivity — a third-party runtime behaviour we observe, never
 * cause. Anchored to the EXACT phrase so a real error that merely mentions
 * the same subsystem is not swallowed.
 */
const RESIZE_OBSERVER_NOISE =
  /^ResizeObserver loop (completed with undelivered notifications\.?|limit exceeded)$/i;
const INLINE_SUGGESTIONS_NOISE = /^Failed to get inline suggestions$/i;
const FB_INAPP_BRIDGE_NOISE =
  /^Error invoking postMessage: Java object is gone$/i;

interface ExceptionValue {
  type?: string;
  value?: string;
  stacktrace?: { frames?: Array<{ filename?: string }> };
}

type DropReason =
  | 'browser-extension'
  | 'expected-user-condition'
  | 'client-network'
  | 'browser-quirk';

/**
 * Should this `$exception` event be discarded before it reaches PostHog?
 * Returns the reason (for a dev-only console breadcrumb) or null to keep.
 */
function classifyDroppableEvent(
  properties: Record<string, unknown>
): DropReason | null {
  const list = Array.isArray(properties.$exception_list)
    ? (properties.$exception_list as ExceptionValue[])
    : [];
  // $exception_values is a FALLBACK for events with no list — genuinely a
  // fallback, not an addition: using both would concatenate the same text
  // twice and break any rule anchored with `^...$` (see the ENG-853 rules
  // above).
  const messages =
    list.length === 0 && Array.isArray(properties.$exception_values)
      ? (properties.$exception_values as unknown[]).filter(
          (m): m is string => typeof m === 'string'
        )
      : [];

  const text = [...messages, ...list.map((v) => v.value)]
    .filter(Boolean)
    .join(' ');

  const fromExtension = list.some((v) =>
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

export const dropPostHogNoise: BeforeSendFn = (
  event: CaptureResult | null
): CaptureResult | null => {
  if (!event) return event;
  // Only exceptions are filtered. This hook sees EVERY captured event, so
  // analytics ($pageview, $autocapture, $feature_flag_called…) must pass
  // through untouched.
  if (event.event !== '$exception') return event;

  const reason = classifyDroppableEvent(event.properties);
  if (!reason) return event;

  if (import.meta.env.DEV) {
    console.debug(`[posthog] dropped ${reason}`, event.properties);
  }
  return null;
};
