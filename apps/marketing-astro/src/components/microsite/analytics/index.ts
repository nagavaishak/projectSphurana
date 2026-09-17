/**
 * The microsite analytics surface.
 *
 * A page wires this up in TWO steps, and the order matters:
 *
 * ```ts
 * // 1. Resolve once, server-side. `null` when the org has no pixel.
 * const analytics = resolveMicrositeAnalytics({ pixelId: doc.pixelId });
 *
 * // 2. Use THE SAME id for the server-side CAPI PageView, then hand the
 * //    whole object to the shell.
 * if (analytics) await sendCapiPageView({ eventId: analytics.pageViewEventId });
 * ```
 *
 * If you mint a second id for CAPI, Meta counts the page view twice.
 */
export {
  CONSENT_STORAGE_KEY,
  CONSENT_VERSION,
  newEventId,
  normaliseEventId,
  normalisePixelId,
  readConsent,
  resolveMicrositeAnalytics,
  writeConsent,
  type ConsentDecision,
  type ConsentStatus,
  type MicrositeAnalyticsConfig,
  type ResolveAnalyticsInput,
  type StoredConsent,
} from './consent';
export {
  PIXEL_SCRIPT_SRC,
  readConfigElement,
  startMicrositeAnalytics,
  type AnalyticsRuntime,
} from './pixel-runtime';
