/**
 * Which Sentry events are NATIVE-ORIGIN, i.e. the ones PostHog cannot see for
 * itself.
 *
 * This predicate is the whole point of the mirror. `apps/app` is one codebase on
 * one DSN, so its Sentry project holds two very different populations:
 *
 *  - JS-layer errors from the WebView. posthog-js ALREADY captures these (and
 *    since 2026-08 so do our own synchronous global handlers). Mirroring them
 *    would duplicate every one.
 *  - Native crashes and ANRs / App Hangs, captured by sentry-cocoa or
 *    sentry-android, persisted to disk and shipped by the NATIVE layer on next
 *    launch. These never enter JavaScript — the @sentry/capacitor bridge is
 *    one-way for events (every method is JS→native; the only inbound listener is
 *    `SentryNativeLog`, which carries log entries) — so no client-side hook can
 *    reach them. They are the sole reason Sentry is a permanent keep.
 *
 * Get this predicate wrong in the permissive direction and PostHog fills with
 * duplicates of errors it already had; wrong in the strict direction and the
 * mirror silently carries nothing. Hence: it is a pure function with tests, and
 * it keys on the SDK that produced the event rather than on tags we set
 * ourselves (`runtime: ios` is on JS-layer events from a phone too, so it cannot
 * distinguish them).
 */

/** The shape we rely on from Sentry's event API. Deliberately minimal. */
export interface SentryApiEvent {
  id?: string;
  eventID?: string;
  platform?: string;
  dateCreated?: string;
  title?: string;
  message?: string;
  culprit?: string;
  tags?: Array<{ key?: string; value?: string }>;
  sdk?: { name?: string; version?: string };
  metadata?: { type?: string; value?: string; function?: string };
  entries?: unknown;
}

/**
 * The JS SDK family, excluded FIRST and explicitly.
 *
 * `sentry.java` is a string prefix of `sentry.javascript`, so a naive
 * `startsWith('sentry.java')` matches `sentry.javascript.capacitor` and mirrors
 * every JS error from a phone — duplicating events posthog-js already captured.
 * That bug was written here and caught by native-event.test.ts; the explicit
 * exclusion and the segment-boundary matching below are BOTH kept so removing
 * either one still leaves the other standing.
 */
const JS_SDK_PREFIX = 'sentry.javascript';

/**
 * SDK names that mean "produced by a native SDK". Matched on a segment
 * boundary — exact, or followed by `.` — because Sentry appends platform detail
 * (`sentry.java.android`, `sentry.cocoa.capacitor`).
 */
const NATIVE_SDK_NAMES = ['sentry.cocoa', 'sentry.java', 'sentry.native'];

const matchesSdkFamily = (sdkName: string, family: string): boolean =>
  sdkName === family || sdkName.startsWith(`${family}.`);

/**
 * Event `platform` values that indicate native origin.
 *
 * THIS IS THE SIGNAL THAT ACTUALLY RUNS. Verified against the live API on
 * 2026-08-17: the project events LIST endpoint the mirror calls
 * (`/projects/{org}/{project}/events/`) returns NO `sdk` field at all — only
 * the single-event endpoint does. So in production `sdk.name` is always absent
 * and `platform` decides every case on its own.
 *
 * Confirmed discriminating on real data over a 90-day window: 99 JS events came
 * back `platform: "javascript"` and the one real native event (the WEB-3D App
 * Hang) came back `platform: "cocoa"`.
 *
 * The `sdk.name` branch above is kept because it is the more specific signal
 * when a caller does have it (the single-event endpoint, or a future API change
 * that adds it back) — not because it is the primary one.
 */
const NATIVE_PLATFORMS = ['cocoa', 'java', 'native', 'android', 'apple'];

export const isNativeOriginEvent = (event: SentryApiEvent): boolean => {
  const sdkName = event.sdk?.name?.toLowerCase();
  if (sdkName) {
    // JS first: it is the population that must never be mirrored, and it shares
    // a string prefix with the Android SDK name.
    if (matchesSdkFamily(sdkName, JS_SDK_PREFIX)) return false;
    return NATIVE_SDK_NAMES.some((family) => matchesSdkFamily(sdkName, family));
  }

  const platform = event.platform?.toLowerCase();
  if (platform) return NATIVE_PLATFORMS.includes(platform);

  // Neither signal present: do NOT mirror. An unmirrored event is a visible gap
  // in PostHog that someone can notice; a wrongly-mirrored one is a duplicate
  // that quietly degrades every count.
  return false;
};

/** Stable id for an event, across the two field spellings Sentry uses. */
export const sentryEventId = (event: SentryApiEvent): string | undefined =>
  event.eventID ?? event.id;

const tagValue = (event: SentryApiEvent, key: string): string | undefined =>
  event.tags?.find((t) => t.key === key)?.value;

/**
 * Map a Sentry event onto the PostHog exception shape.
 *
 * The synthesized Error carries Sentry's own title/type so the two systems group
 * on the same string — cross-referencing an incident between them is the whole
 * value of mirroring, and it breaks the moment the titles diverge.
 */
export const toPostHogException = (
  event: SentryApiEvent
): { error: Error; properties: Record<string, unknown> } => {
  const type = event.metadata?.type ?? 'NativeCrash';
  const value = event.metadata?.value ?? event.title ?? event.message ?? type;

  const error = new Error(value);
  error.name = type;
  // No JS stack exists for a native crash, and a synthesized one would point at
  // this mirror rather than the crash. Better to have none than a lie.
  error.stack = undefined;

  return {
    error,
    properties: {
      // Marks the provenance so these can be included or excluded explicitly.
      // A native crash has no JS frames, so it looks odd next to JS exceptions
      // unless you know where it came from.
      mirrored_from: 'sentry',
      service: 'mobile-native',
      operation: 'native.crash',
      sentry_event_id: sentryEventId(event),
      sentry_sdk: event.sdk?.name,
      platform: event.platform,
      culprit: event.culprit,
      // `os` and `device` are what a native event actually carries — verified
      // against the real WEB-3D App Hang, which has os "iOS 26.6" and device
      // "iPhone14,5". It carries NO `runtime` tag (that one is set by our JS
      // init, so it appears only on JS-origin events), which is why it is not
      // read here.
      release: tagValue(event, 'release'),
      device: tagValue(event, 'device'),
      os: tagValue(event, 'os'),
      // Sentry's own environment tag, NOT the mirroring process's environment —
      // a crash that happened in production must stay tagged production.
      environment: tagValue(event, 'environment'),
    },
  };
};
