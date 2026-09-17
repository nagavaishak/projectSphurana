/**
 * Per-org pixel + Conversions API (§11).
 *
 * The two rules worth knowing before touching anything here:
 *   - ADOPT an existing pixel; create only when the ad account has none.
 *   - `event_id` is shared with the browser event or conversions double-count.
 */

export {
  buildMicrositeEventId,
  type MicrositeEventIdParts,
} from './event-id.js';

export {
  TRACKING_CONSENT_METADATA_KEY,
  decideConsent,
  isConversionEvent,
  readTrackingConsent,
  type ConsentDecision,
  type ConsentDecisionReason,
  type ConsentGateInput,
  type TrackingConsent,
  type TrackingConsentSource,
} from './tracking-consent.js';

export * from './resolve-org-pixel/index.js';
export * from './send-microsite-event/index.js';
export * from './record-tracking-consent/index.js';
