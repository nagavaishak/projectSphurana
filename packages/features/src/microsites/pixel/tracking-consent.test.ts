import { describe, expect, it } from '@borradh-workspace/testing';
import { buildMicrositeEventId } from './event-id.js';
import {
  TRACKING_CONSENT_METADATA_KEY,
  decideConsent,
  readTrackingConsent,
} from './tracking-consent.js';

const consent = (overrides: Record<string, unknown> = {}) => ({
  ads: true,
  source: 'banner' as const,
  at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('decideConsent', () => {
  it('allows anything once ads consent is granted', () => {
    expect(
      decideConsent({ eventName: 'PageView', consent: consent() })
    ).toMatchObject({ allowed: true, reason: 'consent_granted' });
  });

  it('blocks browsing events with no consent record', () => {
    expect(
      decideConsent({ eventName: 'PageView', consent: null })
    ).toMatchObject({ allowed: false, reason: 'consent_missing' });
    expect(
      decideConsent({
        eventName: 'ViewContent',
        consent: consent({ ads: false }),
      })
    ).toMatchObject({ allowed: false, reason: 'consent_denied' });
  });

  it('lets a booking conversion through on its own lawful basis', () => {
    expect(
      decideConsent({
        eventName: 'Schedule',
        consent: consent({ ads: false }),
        hasTransactionBasis: true,
      })
    ).toMatchObject({ allowed: true, reason: 'booking_lawful_basis' });
  });

  it('does NOT let a transaction claim smuggle a PageView through', () => {
    expect(
      decideConsent({
        eventName: 'PageView',
        consent: null,
        hasTransactionBasis: true,
      })
    ).toMatchObject({ allowed: false });
  });

  it('flags limited data use for US visitors either way', () => {
    expect(
      decideConsent({ eventName: 'PageView', consent: null, region: 'us' })
        .limitedDataUse
    ).toBe(true);
    expect(
      decideConsent({
        eventName: 'PageView',
        consent: consent({ region: 'IE' }),
      }).limitedDataUse
    ).toBe(false);
  });
});

describe('readTrackingConsent', () => {
  it('reads the stored decision off lead metadata', () => {
    const stored = readTrackingConsent({
      [TRACKING_CONSENT_METADATA_KEY]: consent({ region: 'IE' }),
    });
    expect(stored).toMatchObject({ ads: true, source: 'banner', region: 'IE' });
  });

  it('returns null for absent or malformed metadata', () => {
    expect(readTrackingConsent(null)).toBeNull();
    expect(readTrackingConsent({})).toBeNull();
    expect(
      readTrackingConsent({ [TRACKING_CONSENT_METADATA_KEY]: { ads: 'yes' } })
    ).toBeNull();
  });
});

describe('buildMicrositeEventId', () => {
  it('is deterministic and normalised, so the browser can recompute it', () => {
    expect(
      buildMicrositeEventId({
        eventName: 'Schedule',
        micrositeId: 'Site_ABC',
        dedupeKey: 'Appt 123',
      })
    ).toBe('schedule:site_abc:appt123');
  });
});
