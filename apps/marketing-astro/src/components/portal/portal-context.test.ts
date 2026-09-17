import { describe, expect, it } from 'vitest';

import {
  portalBookingLink,
  portalLink,
  resolvePortalContext,
  resolvePortalContextFromRequest,
} from './portal-context';

describe('resolvePortalContext', () => {
  it('resolves the path tier from /sites/{slug}', () => {
    const ctx = resolvePortalContext({
      hostname: 'www.borradh.io',
      pathname: '/sites/glow-clinic/portal/bookings/abc',
    });

    expect(ctx).toEqual({
      organizationSlug: 'glow-clinic',
      basePath: '/sites/glow-clinic',
      tier: 'path',
    });
  });

  it('resolves the wildcard tier from a single-label subdomain', () => {
    const ctx = resolvePortalContext({
      hostname: 'glow-clinic.borradh.io',
      pathname: '/portal',
    });

    expect(ctx).toEqual({
      organizationSlug: 'glow-clinic',
      basePath: '',
      tier: 'wildcard',
    });
  });

  it('does NOT read the org out of the portal pathname on a host tier', () => {
    // The apps/app transport regexed `/portal/{slug}/…` out of the URL. Under
    // host-implies-org that regex yields "bookings" — every authenticated call
    // would then 401. Guard the behaviour, not just the helper.
    const ctx = resolvePortalContext({
      hostname: 'glow-clinic.borradh.io',
      pathname: '/portal/bookings/appointment-1',
    });

    expect(ctx?.organizationSlug).toBe('glow-clinic');
  });

  it('returns null on a custom domain, where no slug is derivable', () => {
    expect(
      resolvePortalContext({
        hostname: 'theglowclinic.com',
        pathname: '/portal',
      })
    ).toBeNull();
  });

  it('returns null for a nested subdomain, which is not a tenant', () => {
    expect(
      resolvePortalContext({
        hostname: 'a.b.borradh.io',
        pathname: '/portal',
      })
    ).toBeNull();
  });
});

describe('portalLink', () => {
  it('prefixes the base path on the path tier', () => {
    const ctx = { basePath: '/sites/glow-clinic' };
    expect(portalLink(ctx)).toBe('/sites/glow-clinic/portal');
    expect(portalLink(ctx, '/sign-in')).toBe(
      '/sites/glow-clinic/portal/sign-in'
    );
    expect(portalLink(ctx, '/bookings/abc')).toBe(
      '/sites/glow-clinic/portal/bookings/abc'
    );
  });

  it('emits bare /portal paths on host tiers', () => {
    const ctx = { basePath: '' };
    expect(portalLink(ctx)).toBe('/portal');
    expect(portalLink(ctx, '/documents')).toBe('/portal/documents');
  });

  it("treats '/' as the portal root, not a trailing slash", () => {
    expect(portalLink({ basePath: '' }, '/')).toBe('/portal');
  });
});

describe('portalBookingLink', () => {
  it('hangs off the microsite base, like every other surface', () => {
    expect(
      portalBookingLink({
        organizationSlug: 'glow-clinic',
        basePath: '/sites/glow-clinic',
        tier: 'path',
      })
    ).toBe('/sites/glow-clinic/book');
  });

  it('drops the prefix on a tenant host — the org is implied by the hostname', () => {
    expect(
      portalBookingLink({
        organizationSlug: 'glow-clinic',
        basePath: '',
        tier: 'wildcard',
      })
    ).toBe('/book');
  });

  it('never emits the retired top-level /book/{slug} shape', () => {
    // That shape 301s now, so building one costs every customer a redirect —
    // and on the wildcard tier it would leave the tenant's own host.
    for (const tier of ['path', 'wildcard'] as const) {
      const url = portalBookingLink({
        organizationSlug: 'glow-clinic',
        basePath: tier === 'path' ? '/sites/glow-clinic' : '',
        tier,
      });
      expect(url).not.toBe('/book/glow-clinic');
    }
  });
});

describe('resolvePortalContextFromRequest', () => {
  const req = (host: string) =>
    new Request('https://internal.vercel.app/portal', {
      headers: { host },
    });

  it('prefers the forwarded host over the internal rewrite host', () => {
    // Behind Vercel `url.hostname` is the internal target. Trusting it would
    // resolve every tenant host to the platform and find no org.
    const ctx = resolvePortalContextFromRequest(
      req('glow-clinic.borradh.io'),
      new URL('https://internal-rewrite.vercel.app/portal')
    );

    expect(ctx?.organizationSlug).toBe('glow-clinic');
    expect(ctx?.tier).toBe('wildcard');
  });

  it('strips a port from the host header (local dev)', () => {
    const ctx = resolvePortalContextFromRequest(
      req('glow-clinic.borradh-dev.com:3003'),
      new URL('http://localhost:3003/portal')
    );

    expect(ctx?.organizationSlug).toBe('glow-clinic');
  });

  it('still resolves the path tier from the URL pathname', () => {
    const ctx = resolvePortalContextFromRequest(
      req('www.borradh.io'),
      new URL('https://www.borradh.io/sites/glow-clinic/portal/documents')
    );

    expect(ctx).toEqual({
      organizationSlug: 'glow-clinic',
      basePath: '/sites/glow-clinic',
      tier: 'path',
    });
  });
});

describe('middleware-resolved override', () => {
  it('drops the /sites prefix on a tenant host', () => {
    // The middleware rewrites salon.com/portal to /sites/{slug}/portal
    // internally, so the pathname alone looks exactly like the path tier.
    // Without this override every in-portal link would carry OUR prefix on the
    // TENANT's own domain — the first URL clean, the second one not.
    const ctx = resolvePortalContextFromRequest(
      new Request('https://salon.com/sites/acme/portal'),
      new URL('https://salon.com/sites/acme/portal'),
      { slug: 'acme', tier: 'custom' }
    );
    expect(ctx?.basePath).toBe('');
    expect(ctx?.organizationSlug).toBe('acme');
    // portalLink adds the /portal segment itself; what matters is the ABSENCE
    // of a /sites/{slug} prefix on the tenant's own domain.
    expect(portalLink(ctx as never, '/bookings')).toBe('/portal/bookings');
    expect(portalLink(ctx as never, '/bookings')).not.toContain('/sites/');
  });

  it('keeps the prefix on the real path tier', () => {
    const ctx = resolvePortalContextFromRequest(
      new Request('https://www.borradh.io/sites/acme/portal'),
      new URL('https://www.borradh.io/sites/acme/portal'),
      { slug: 'acme', tier: 'path' }
    );
    expect(ctx?.basePath).toBe('/sites/acme');
    expect(portalLink(ctx as never, '/bookings')).toBe(
      '/sites/acme/portal/bookings'
    );
  });

  it('falls back to host/path derivation when the middleware resolved nothing', () => {
    const ctx = resolvePortalContextFromRequest(
      new Request('https://www.borradh.io/sites/acme/portal'),
      new URL('https://www.borradh.io/sites/acme/portal'),
      null
    );
    expect(ctx?.organizationSlug).toBe('acme');
  });
});
