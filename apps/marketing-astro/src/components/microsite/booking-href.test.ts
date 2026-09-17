import { describe, expect, it } from 'vitest';

import { resolveBookingHref } from './booking-href';

const RESOLVED = '/sites/glow-clinic/book';

describe('resolveBookingHref', () => {
  it('uses the resolved url when nothing is stored', () => {
    expect(resolveBookingHref(undefined, RESOLVED)).toBe(RESOLVED);
    expect(resolveBookingHref('  ', RESOLVED)).toBe(RESOLVED);
  });

  it('overrides the RETIRED literal that provisioning baked in', () => {
    // The whole point: documents created before the provisioner was fixed
    // carry this, and on the path tier it 404s. Fixing only the provisioner
    // leaves every existing site broken.
    expect(resolveBookingHref('/book', RESOLVED)).toBe(RESOLVED);
    expect(resolveBookingHref('/book/glow-clinic', RESOLVED)).toBe(RESOLVED);
  });

  it('honours a link a person actually chose', () => {
    expect(resolveBookingHref('/book-online', RESOLVED)).toBe('/book-online');
    expect(
      resolveBookingHref('https://old.example.com/booking', RESOLVED)
    ).toBe('https://old.example.com/booking');
    expect(resolveBookingHref('/offers', RESOLVED)).toBe('/offers');
  });

  it('falls back to the stored value rather than rendering nothing', () => {
    // A missing bookingUrl is a bug elsewhere; dropping the CTA entirely would
    // hide it and cost the conversion the block exists for.
    expect(resolveBookingHref('/book', undefined)).toBe('/book');
    expect(resolveBookingHref(undefined, undefined)).toBeUndefined();
  });
});
