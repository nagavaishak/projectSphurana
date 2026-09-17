/**
 * The routing decision that turns a tenant host into a microsite.
 *
 * The failure modes this pins are the expensive ones: classifying our OWN
 * infrastructure as a tenant (which 404s the whole marketing site on previews),
 * rewriting `/book/*` (which kills the booking flow, the primary conversion
 * target), guessing a slug from a hostname (which serves one clinic's customer
 * another clinic's site), and answering an unknown host with a REDIRECT instead
 * of a 404 (which turns a bad DNS record into a loop that reads as an outage).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyHost,
  decideMicrositeRoute,
  isSkippedPath,
  micrositeHostErrorResponse,
  micrositeRewritePath,
} from './_microsite-routing';

const SITE = {
  micrositeId: 'site-1',
  organizationId: 'org-1',
  slug: 'acme',
  status: 'published' as const,
  tier: 'custom' as const,
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const deps = (fetchImpl: typeof fetch) => ({
  apiUrl: 'https://api.test',
  fetch: fetchImpl,
});

beforeEach(() => {
  vi.stubEnv('MICROSITE_BASE_DOMAIN', 'borradh.io,borradh-dev.com');
});

afterEach(() => vi.unstubAllEnvs());

describe('classifyHost', () => {
  it.each([
    ['borradh.io'],
    ['www.borradh.io'],
    ['localhost'],
    ['127.0.0.1'],
    ['borradh-marketing-pr-12.vercel.app'],
    // Nested platform subdomain: local dev + the app itself. Not a tenant —
    // treating it as one would let anyone who can create a CNAME claim a slug.
    ['app.daniel.borradh-dev.com'],
  ])('treats %s as a platform host', (host) => {
    expect(classifyHost(host).kind).toBe('platform');
  });

  it('treats a single-label subdomain as the wildcard tier', () => {
    expect(classifyHost('acme.borradh.io')).toEqual({
      kind: 'tenant',
      tier: 'wildcard',
    });
  });

  it('treats a foreign host as the custom tier', () => {
    expect(classifyHost('Salon.com:443')).toEqual({
      kind: 'tenant',
      tier: 'custom',
    });
  });
});

describe('isSkippedPath', () => {
  it.each([
    ['/_astro/index.css'],
    ['/api/public/venue'],
    ['/book/acme'],
    // The public venue page is a route of THIS app carrying its own org slug.
    // Rewritten into the microsite it becomes /sites/{slug}/venue/{slug},
    // which is not a page — a tenant host would 404 its own venue link.
    ['/venue/acme'],
    ['/venue/acme/main-street'],
    ['/sites/acme/about'],
    ['/favicon.ico'],
    ['/.well-known/acme-challenge/x'],
    ['/dashboard/settings'],
  ])('skips %s', (path) => {
    expect(isSkippedPath(path)).toBe(true);
  });

  it.each([['/'], ['/about'], ['/portal'], ['/portal/bookings/abc']])(
    'does not skip %s',
    (path) => {
      expect(isSkippedPath(path)).toBe(false);
    }
  );
});

describe('micrositeRewritePath', () => {
  it.each([
    ['/', '/sites/acme'],
    ['/about', '/sites/acme/about'],
    ['/portal', '/sites/acme/portal'],
    ['/portal/bookings/abc', '/sites/acme/portal/bookings/abc'],
  ])('rewrites %s', (pathname, expected) => {
    expect(micrositeRewritePath('acme', pathname)).toBe(expected);
  });

  it('preserves the query string (attribution survives the rewrite)', () => {
    expect(micrositeRewritePath('acme', '/', '?utm_source=meta')).toBe(
      '/sites/acme?utm_source=meta'
    );
  });
});

describe('decideMicrositeRoute', () => {
  it('rewrites a custom host onto the path-tier routes', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(SITE));

    const route = await decideMicrositeRoute(
      { host: 'salon.com', pathname: '/about' },
      deps(fetchMock as unknown as typeof fetch)
    );

    expect(route).toEqual({
      kind: 'rewrite',
      path: '/sites/acme/about',
      site: SITE,
    });
    // The slug came from the API, not from the hostname.
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/public/microsites/resolve?host=salon.com&path=%2Fabout',
      expect.anything()
    );
  });

  /** §5.1: the portal on a custom host resolves server-side or not at all. */
  it('rewrites the portal on a custom host', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(SITE));

    const route = await decideMicrositeRoute(
      { host: 'salon.com', pathname: '/portal/documents' },
      deps(fetchMock as unknown as typeof fetch)
    );

    expect(route).toMatchObject({
      kind: 'rewrite',
      path: '/sites/acme/portal/documents',
    });
  });

  it('rewrites a wildcard host', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ ...SITE, tier: 'wildcard' })
    );

    const route = await decideMicrositeRoute(
      { host: 'acme.borradh.io', pathname: '/' },
      deps(fetchMock as unknown as typeof fetch)
    );

    expect(route).toMatchObject({ kind: 'rewrite', path: '/sites/acme' });
  });

  it('leaves the marketing apex alone', async () => {
    const fetchMock = vi.fn();

    const route = await decideMicrositeRoute(
      { host: 'www.borradh.io', pathname: '/pricing' },
      deps(fetchMock as unknown as typeof fetch)
    );

    expect(route).toEqual({ kind: 'passthrough' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * `/book/{slug}` is a route of this app already and carries the org in its
   * own URL. Rewriting it would 404 the booking flow on every tenant host.
   */
  it('leaves /book alone on a tenant host', async () => {
    const fetchMock = vi.fn();

    const route = await decideMicrositeRoute(
      { host: 'salon.com', pathname: '/book/acme' },
      deps(fetchMock as unknown as typeof fetch)
    );

    expect(route).toEqual({ kind: 'passthrough' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('404s an unknown host — never a redirect', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 404 }));

    const route = await decideMicrositeRoute(
      { host: 'not-a-tenant.com', pathname: '/' },
      deps(fetchMock as unknown as typeof fetch)
    );

    expect(route).toEqual({ kind: 'not-found' });
  });

  /** An outage must not be reported as "this domain is not set up". */
  it('reports unavailable when the API errors or times out', async () => {
    const failing = vi.fn(async () => new Response('', { status: 500 }));
    expect(
      await decideMicrositeRoute(
        { host: 'salon.com', pathname: '/' },
        deps(failing as unknown as typeof fetch)
      )
    ).toEqual({ kind: 'unavailable' });

    const throwing = vi.fn(async () => {
      throw new Error('ETIMEDOUT');
    });
    expect(
      await decideMicrositeRoute(
        { host: 'salon.com', pathname: '/' },
        deps(throwing as unknown as typeof fetch)
      )
    ).toEqual({ kind: 'unavailable' });
  });

  it('treats a response without a slug as unknown rather than guessing one', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ micrositeId: 'x' }));

    const route = await decideMicrositeRoute(
      { host: 'salon.com', pathname: '/' },
      deps(fetchMock as unknown as typeof fetch)
    );

    expect(route).toEqual({ kind: 'not-found' });
  });
});

describe('micrositeHostErrorResponse', () => {
  it('is a 404 with no redirect and no caching', () => {
    const response = micrositeHostErrorResponse('not-found');

    expect(response.status).toBe(404);
    expect(response.headers.get('location')).toBeNull();
    // A cached 404 outlives the DNS fix that resolves it.
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('separates an outage (503) from an unknown host (404)', () => {
    expect(micrositeHostErrorResponse('unavailable').status).toBe(503);
  });
});
