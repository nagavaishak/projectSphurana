import { describe, expect, it } from '@borradh-workspace/testing';
import { timezoneForLocation } from './timezone.js';

/**
 * These cases are the real prod locations from the 2026-08-12 incident, not
 * invented coordinates — the calendar had been pinning every org to UTC, and
 * `Citrus and Sage` (Redlands, California) was the org that surfaced it.
 */
describe('timezoneForLocation', () => {
  describe('exact resolution from coordinates', () => {
    it('resolves Redlands, California to Pacific', () => {
      expect(
        timezoneForLocation({ latitude: 34.068844, longitude: -117.140015 })
      ).toBe('America/Los_Angeles');
    });

    it('resolves Dublin to Europe/Dublin', () => {
      expect(
        timezoneForLocation({ latitude: 53.3498, longitude: -6.2603 })
      ).toBe('Europe/Dublin');
    });

    // Northern Ireland is UK but sits on the island of Ireland — the case the
    // prod backfill had to call out by hand for `nafi aesthetics`.
    it('resolves Portadown to Europe/London, not Europe/Dublin', () => {
      expect(
        timezoneForLocation({ latitude: 54.4225, longitude: -6.4453 })
      ).toBe('Europe/London');
    });

    // The whole reason coordinates beat the country map: one country, six zones.
    it('splits US coordinates across zones rather than lumping them', () => {
      const la = timezoneForLocation({
        latitude: 34.0522,
        longitude: -118.2437,
      });
      const ny = timezoneForLocation({ latitude: 40.7128, longitude: -74.006 });
      expect(la).toBe('America/Los_Angeles');
      expect(ny).toBe('America/New_York');
      expect(la).not.toBe(ny);
    });

    it('prefers coordinates over the country fallback when both are present', () => {
      // Country says `us` (which would fall back to New York); the coordinates
      // say California. Coordinates must win.
      expect(
        timezoneForLocation({
          latitude: 34.068844,
          longitude: -117.140015,
          country: 'us',
        })
      ).toBe('America/Los_Angeles');
    });
  });

  describe('country fallback (no coordinates)', () => {
    it('resolves single-zone countries exactly', () => {
      expect(timezoneForLocation({ country: 'ie' })).toBe('Europe/Dublin');
      expect(timezoneForLocation({ country: 'gb' })).toBe('Europe/London');
    });

    it('accepts an uppercase country code', () => {
      expect(timezoneForLocation({ country: 'IE' })).toBe('Europe/Dublin');
    });

    it('returns a plausible zone for multi-zone countries', () => {
      // Documented as a GUESS, not a derivation. Asserted so that changing it
      // is a deliberate act rather than a silent drift.
      expect(timezoneForLocation({ country: 'us' })).toBe('America/New_York');
    });
  });

  describe('never invents a zone', () => {
    it('returns null with neither coordinates nor country', () => {
      expect(timezoneForLocation({})).toBeNull();
      expect(timezoneForLocation(null)).toBeNull();
      expect(timezoneForLocation(undefined)).toBeNull();
    });

    it('returns null for an unknown country', () => {
      expect(timezoneForLocation({ country: 'zz' })).toBeNull();
    });

    it('ignores a half-set coordinate pair rather than guessing', () => {
      expect(timezoneForLocation({ latitude: 53.3498 })).toBeNull();
      expect(timezoneForLocation({ longitude: -6.2603 })).toBeNull();
    });

    it('falls back to the country when coordinates are out of range', () => {
      // tzlookup throws on impossible coordinates; that must not escape, and
      // must not discard a usable country.
      expect(
        timezoneForLocation({ latitude: 999, longitude: 999, country: 'ie' })
      ).toBe('Europe/Dublin');
    });

    it('returns null for out-of-range coordinates with no country', () => {
      expect(timezoneForLocation({ latitude: 999, longitude: 999 })).toBeNull();
    });

    it('ignores NaN coordinates', () => {
      expect(
        timezoneForLocation({ latitude: Number.NaN, longitude: Number.NaN })
      ).toBeNull();
    });
  });
});
