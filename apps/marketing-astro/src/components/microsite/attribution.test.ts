/**
 * The ad click's attribution has to survive the hop from the microsite (which
 * the visitor lands on) to `/book/*` (where the lead is actually created) — two
 * different routes, only one of which knows which site the visitor came from.
 *
 * The invariant these guard is plan §9: what travels is the SITE ID, never the
 * host. A tenant moving from `salon.borradh.io` to `salon.com` must keep one
 * attribution history.
 */
import { describe, expect, it } from 'vitest';
import {
  MICROSITE_ATTRIBUTION_PARAM,
  readMicrositeAttribution,
  withMicrositeAttribution,
} from './attribution';

describe('withMicrositeAttribution', () => {
  it('carries the site id and the UTMs onto the booking link', () => {
    const url = withMicrositeAttribution('https://app.test/book/glow', {
      micrositeId: 'site-1',
      search: '?utm_source=meta&utm_medium=paid_social&utm_campaign=camp_1',
    });

    const params = new URL(url).searchParams;
    expect(params.get(MICROSITE_ATTRIBUTION_PARAM)).toBe('site-1');
    expect(params.get('utm_source')).toBe('meta');
    expect(params.get('utm_campaign')).toBe('camp_1');
  });

  it('never puts the host in the link — the same site tags identically on both', () => {
    const tag = (host: string) =>
      withMicrositeAttribution('https://app.test/book/glow', {
        micrositeId: 'site-1',
        search: `?utm_campaign=camp_1&host=${host}`,
      });

    expect(tag('salon.borradh.io')).toBe(tag('salon.com'));
    expect(tag('salon.com')).not.toContain('salon.com');
  });

  it('copies nothing else off the landing page', () => {
    const url = withMicrositeAttribution('https://app.test/book/glow', {
      micrositeId: 'site-1',
      search: '?email=someone%40example.com&fbclid=abc',
    });

    expect(url).not.toContain('email');
    expect(url).not.toContain('fbclid');
  });

  it('leaves the link untouched when there is nothing to attribute', () => {
    expect(
      withMicrositeAttribution('https://app.test/book/glow', { search: '' })
    ).toBe('https://app.test/book/glow');
  });

  it('does not overwrite params the link already carries', () => {
    const url = withMicrositeAttribution(
      'https://app.test/book/glow?utm_campaign=from_email',
      { micrositeId: 'site-1', search: '?utm_campaign=camp_1' }
    );

    expect(new URL(url).searchParams.get('utm_campaign')).toBe('from_email');
  });
});

describe('readMicrositeAttribution', () => {
  it('reads the site id back off the booking URL and sends the URL whole', () => {
    const attribution = readMicrositeAttribution(
      'https://app.test/book/glow?ms=site-1&utm_source=meta'
    );

    expect(attribution.micrositeId).toBe('site-1');
    expect(attribution.landingUrl).toContain('utm_source=meta');
  });

  it('reports no microsite for a direct visit', () => {
    expect(
      readMicrositeAttribution('https://app.test/book/glow').micrositeId
    ).toBeUndefined();
  });
});
