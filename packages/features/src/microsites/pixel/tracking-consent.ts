/**
 * Consent state, and the rule that decides whether an event may be sent.
 *
 * §9.7: SERVER-SIDE IS NOT A LOOPHOLE. The microsite is OUR page on the
 * tenant's domain, so for IE/UK/EU visitors the GDPR liability is ours. CAPI is
 * gated on exactly the same signal as the browser pixel.
 *
 * The one asymmetry is lawful basis, not channel:
 *
 * - `PageView` / `ViewContent` are OBSERVATION of a visitor who has done
 *   nothing. Consent is the only basis, so no consent → no event, browser or
 *   server.
 * - `Schedule` / `Purchase` / `Lead` describe a booking the person actually
 *   made. That transaction is its own lawful basis, so the conversion still
 *   flows for a customer who never accepted the banner — which is also what
 *   keeps CAC measurable when banner acceptance is low.
 *
 * The consent state is stored ON THE LEAD (`lead.metadata.trackingConsent`) so
 * attribution stays reconstructable either way: months later you can still say
 * which basis a given event was sent under.
 */

import type { MetaCapiEventName } from '@borradh-workspace/integrations/meta-capi';

/** Where the consent decision came from — an audit field, not a control. */
export type TrackingConsentSource =
  | 'banner'
  | 'booking_form'
  | 'imported'
  | 'unknown';

export interface TrackingConsent {
  /** Marketing/ads measurement. THE flag the Meta pixel and CAPI are gated on. */
  ads: boolean;
  /** Non-marketing analytics. Recorded for completeness; Meta events don't use it. */
  analytics?: boolean;
  source: TrackingConsentSource;
  /** ISO-8601. When the visitor made this choice. */
  at: string;
  /** ISO-3166-1 alpha-2 of the visitor, when known. Drives LDU below. */
  region?: string;
  /**
   * US/CCPA Limited Data Use. Explicitly stored rather than inferred at send
   * time, so a later region-lookup change cannot retroactively alter how an
   * event that already went out was described.
   */
  limitedDataUse?: boolean;
}

/** The key under `lead.metadata` this state lives at. */
export const TRACKING_CONSENT_METADATA_KEY = 'trackingConsent' as const;

/** Events that describe a transaction the person deliberately completed. */
const CONVERSION_EVENTS = new Set<MetaCapiEventName>([
  'Lead',
  'Contact',
  'Schedule',
  'InitiateCheckout',
  'Purchase',
  'CompleteRegistration',
]);

export const isConversionEvent = (name: MetaCapiEventName): boolean =>
  CONVERSION_EVENTS.has(name);

/**
 * Why an event was allowed or suppressed. Returned (and logged) so a low
 * conversion count can be explained without guessing.
 */
export type ConsentDecisionReason =
  | 'consent_granted'
  | 'booking_lawful_basis'
  | 'consent_missing'
  | 'consent_denied';

export interface ConsentDecision {
  allowed: boolean;
  reason: ConsentDecisionReason;
  /** Whether the outgoing event must carry `data_processing_options: ['LDU']`. */
  limitedDataUse: boolean;
}

export interface ConsentGateInput {
  eventName: MetaCapiEventName;
  /** Null when the visitor is unknown or never answered the banner. */
  consent: TrackingConsent | null | undefined;
  /**
   * True when this event describes a booking/transaction the person completed.
   * The CALLER asserts this — it is a claim about what happened, and only the
   * booking path may make it.
   */
  hasTransactionBasis?: boolean;
  /** Visitor country when no consent record carries one. */
  region?: string | null;
}

/** US visitors get Limited Data Use whether or not they accepted the banner. */
const requiresLimitedDataUse = (
  consent: TrackingConsent | null | undefined,
  region?: string | null
): boolean => {
  if (consent?.limitedDataUse) return true;
  const country = (consent?.region ?? region ?? '').trim().toUpperCase();
  return country === 'US';
};

export const decideConsent = ({
  eventName,
  consent,
  hasTransactionBasis = false,
  region,
}: ConsentGateInput): ConsentDecision => {
  const limitedDataUse = requiresLimitedDataUse(consent, region);

  if (consent?.ads === true) {
    return { allowed: true, reason: 'consent_granted', limitedDataUse };
  }

  // No consent. A conversion for someone who actually booked still has a
  // lawful basis; observing a visitor who merely loaded a page does not.
  if (hasTransactionBasis && isConversionEvent(eventName)) {
    return { allowed: true, reason: 'booking_lawful_basis', limitedDataUse };
  }

  return {
    allowed: false,
    reason: consent ? 'consent_denied' : 'consent_missing',
    limitedDataUse,
  };
};

/** Read the consent state off a lead row's `metadata` jsonb, defensively. */
export const readTrackingConsent = (
  metadata: unknown
): TrackingConsent | null => {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as Record<string, unknown>)[
    TRACKING_CONSENT_METADATA_KEY
  ];
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<TrackingConsent>;
  if (typeof candidate.ads !== 'boolean') return null;
  return {
    ads: candidate.ads,
    analytics:
      typeof candidate.analytics === 'boolean'
        ? candidate.analytics
        : undefined,
    source: candidate.source ?? 'unknown',
    at: candidate.at ?? new Date(0).toISOString(),
    region: candidate.region,
    limitedDataUse: candidate.limitedDataUse,
  };
};
