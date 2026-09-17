import { getRedis } from '@borradh-workspace/redis';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { type MockDb, createMockDb } from '../shared/mock-db.test-utils.js';
import {
  ORG_ID,
  SITE_ID,
  micrositeRow,
} from '../shared/test-fixtures.test-utils.js';
import {
  normalizeHost,
  resolveMicrositeHost,
} from './resolve-microsite-host.service.js';

let db: MockDb;

const siteColumns = {
  id: SITE_ID,
  organizationId: ORG_ID,
  slug: 'acme-salon',
  status: 'published' as const,
};

describe('normalizeHost', () => {
  it.each([
    ['ACME.borradh.io', 'acme.borradh.io'],
    ['acme.borradh.io:3000', 'acme.borradh.io'],
    ['acme.borradh.io.', 'acme.borradh.io'],
    ['https://acme.borradh.io/about', 'acme.borradh.io'],
    ['  acme.borradh.io  ', 'acme.borradh.io'],
  ])('normalises %s', (raw, expected) => {
    expect(normalizeHost(raw)).toBe(expected);
  });
});

describe('resolveMicrositeHost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MICROSITE_BASE_DOMAIN', 'borradh.io');
    db = createMockDb();
    db.query.microsite.findFirst.mockResolvedValue(undefined);
    db.query.micrositeDomain.findFirst.mockResolvedValue(undefined);
  });

  afterEach(() => vi.unstubAllEnvs());

  /* ── Tier 1: custom domain ──────────────────────────────────────── */

  it('resolves an active custom domain', async () => {
    db.query.micrositeDomain.findFirst.mockResolvedValue({
      micrositeId: SITE_ID,
      organizationId: ORG_ID,
      microsite: siteColumns,
    });

    const result = await resolveMicrositeHost(db as never, {
      host: 'SalonName.com:443',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      micrositeId: SITE_ID,
      organizationId: ORG_ID,
      slug: 'acme-salon',
      status: 'published',
      tier: 'custom',
    });
  });

  it('falls back from www to the apex form of a custom domain', async () => {
    db.query.micrositeDomain.findFirst
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        micrositeId: SITE_ID,
        organizationId: ORG_ID,
        microsite: siteColumns,
      });

    const result = await resolveMicrositeHost(db as never, {
      host: 'www.salonname.com',
    });

    expect(result.success).toBe(true);
    expect(db.query.micrositeDomain.findFirst).toHaveBeenCalledTimes(2);
  });

  /**
   * A half-verified hostname must NOT serve a site — the status predicate is
   * in the query, so a `pending_dns` row simply misses.
   */
  it('does not resolve an unverified custom domain', async () => {
    db.query.micrositeDomain.findFirst.mockResolvedValue(undefined);

    const result = await resolveMicrositeHost(db as never, {
      host: 'salonname.com',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  /**
   * The path tier is the fallback that needs no DNS, so it must not depend on
   * recognising the host. It did: an unknown host went down the custom-domain
   * branch and returned null before Tier 3 was consulted, so a published site
   * answered "Unknown host" on every Vercel preview and every localhost stack
   * — everywhere the feature is actually developed and tested.
   */
  it('resolves /sites/{slug} on an UNRECOGNISED host — previews and localhost', async () => {
    db.query.micrositeDomain.findFirst.mockResolvedValue(undefined);
    db.query.microsite.findFirst.mockResolvedValue(siteColumns);

    for (const host of [
      'localhost:3003',
      'borradh-marketing-astro-abc123-borradh-technologies.vercel.app',
    ]) {
      const result = await resolveMicrositeHost(db as never, {
        host,
        path: '/sites/acme-salon',
      });

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.tier).toBe('path');
    }
  });

  it('still prefers a live custom domain over the path in the URL', async () => {
    // Ordering matters for isolation: falling through must not let
    // `salonname.com/sites/other-tenant` serve someone else's site.
    db.query.micrositeDomain.findFirst.mockResolvedValue({
      micrositeId: 'ms_1',
      organizationId: 'org_1',
      microsite: siteColumns,
    });

    const result = await resolveMicrositeHost(db as never, {
      host: 'salonname.com',
      path: '/sites/some-other-tenant',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tier).toBe('custom');
  });

  /* ── Tier 2: wildcard ───────────────────────────────────────────── */

  it('resolves {slug}.borradh.io', async () => {
    db.query.microsite.findFirst.mockResolvedValue(siteColumns);

    const result = await resolveMicrositeHost(db as never, {
      host: 'acme-salon.borradh.io',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tier).toBe('wildcard');
    // The wildcard tier must never hit the custom-domain table.
    expect(db.query.micrositeDomain.findFirst).not.toHaveBeenCalled();
  });

  it('does not treat a reserved label as a tenant slug', async () => {
    const result = await resolveMicrositeHost(db as never, {
      host: 'www.borradh.io',
      path: '/pricing',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    expect(db.query.microsite.findFirst).not.toHaveBeenCalled();
  });

  it('does not resolve a nested subdomain', async () => {
    const result = await resolveMicrositeHost(db as never, {
      host: 'www.acme-salon.borradh.io',
    });

    expect(result.success).toBe(false);
    expect(db.query.microsite.findFirst).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for an unknown slug on the wildcard apex', async () => {
    const result = await resolveMicrositeHost(db as never, {
      host: 'nobody.borradh.io',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  /* ── Tier 3: path ───────────────────────────────────────────────── */

  it('resolves borradh.io/sites/{slug}', async () => {
    db.query.microsite.findFirst.mockResolvedValue(siteColumns);

    const result = await resolveMicrositeHost(db as never, {
      host: 'borradh.io',
      path: '/sites/acme-salon/about',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tier).toBe('path');
  });

  it('returns NOT_FOUND on the apex with no /sites path', async () => {
    const result = await resolveMicrositeHost(db as never, {
      host: 'borradh.io',
      path: '/pricing',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('honours additional apexes from MICROSITE_BASE_DOMAIN', async () => {
    vi.stubEnv('MICROSITE_BASE_DOMAIN', 'borradh.io,borradh.site');
    db.query.microsite.findFirst.mockResolvedValue(siteColumns);

    const result = await resolveMicrositeHost(db as never, {
      host: 'acme-salon.borradh.site',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tier).toBe('wildcard');
  });

  /* ── The public contract ────────────────────────────────────────── */

  it('returns identifiers only — never the document or the theme', async () => {
    db.query.microsite.findFirst.mockResolvedValue(siteColumns);

    const result = await resolveMicrositeHost(db as never, {
      host: 'acme-salon.borradh.io',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    // This is the one unauthenticated service in the folder. Widening it is a
    // security change, so the shape is pinned exactly.
    expect(Object.keys(result.data).sort()).toEqual([
      'micrositeId',
      'organizationId',
      'slug',
      'status',
      'tier',
    ]);
  });

  it('resolves a draft microsite but reports its status', async () => {
    db.query.microsite.findFirst.mockResolvedValue(
      micrositeRow({ status: 'draft' })
    );

    const result = await resolveMicrositeHost(db as never, {
      host: 'acme-salon.borradh.io',
    });

    expect(result.success).toBe(true);
    // Resolution is not authorization to render — the caller decides what an
    // unpublished site shows.
    if (result.success) expect(result.data.status).toBe('draft');
  });

  it('returns VALIDATION_ERROR for an empty host', async () => {
    const result = await resolveMicrositeHost(db as never, { host: '   ' });

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  /* ── The cache (contract §3) ────────────────────────────────────── */

  describe('caching', () => {
    const redis = () => vi.mocked(getRedis)();

    it('answers a cached hit without touching the database', async () => {
      redis().get.mockResolvedValueOnce(
        JSON.stringify({
          micrositeId: SITE_ID,
          organizationId: ORG_ID,
          slug: 'acme-salon',
          status: 'published',
          tier: 'custom',
        })
      );

      const result = await resolveMicrositeHost(db as never, {
        host: 'salonname.com',
      });

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.slug).toBe('acme-salon');
      // The whole point: one cache read, zero queries, on the hot path.
      expect(redis().get).toHaveBeenCalledTimes(1);
      expect(db.query.micrositeDomain.findFirst).not.toHaveBeenCalled();
      expect(db.query.microsite.findFirst).not.toHaveBeenCalled();
    });

    /**
     * Scanner traffic from the open internet is the common case for an unknown
     * host. Without the negative entry each of those hits is a query.
     */
    it('answers a cached miss without touching the database', async () => {
      redis().get.mockResolvedValueOnce('__miss__');

      const result = await resolveMicrositeHost(db as never, {
        host: 'scanner-bait.com',
      });

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(db.query.micrositeDomain.findFirst).not.toHaveBeenCalled();
    });

    it('caches a resolution under the host key', async () => {
      db.query.microsite.findFirst.mockResolvedValue(siteColumns);

      await resolveMicrositeHost(db as never, {
        host: 'acme-salon.borradh.io',
      });

      expect(redis().set).toHaveBeenCalledWith(
        'microsite:host:acme-salon.borradh.io',
        expect.stringContaining('acme-salon'),
        'EX',
        300
      );
    });

    it('caches an unknown host as a miss, at the shorter TTL', async () => {
      await resolveMicrositeHost(db as never, { host: 'nobody.com' });

      expect(redis().set).toHaveBeenCalledWith(
        'microsite:host:nobody.com',
        '__miss__',
        'EX',
        60
      );
    });

    /** One apex serves every tenant — the path tier must not key on the host alone. */
    it('keys the path tier on the slug as well as the host', async () => {
      db.query.microsite.findFirst.mockResolvedValue(siteColumns);

      await resolveMicrositeHost(db as never, {
        host: 'borradh.io',
        path: '/sites/acme-salon/about',
      });

      expect(redis().set).toHaveBeenCalledWith(
        'microsite:host:borradh.io:/sites/acme-salon',
        expect.any(String),
        'EX',
        300
      );
    });

    /**
     * Every marketing path on the apex would otherwise share one key, and the
     * answer is known without a query anyway.
     */
    it('does not cache the bare marketing apex', async () => {
      const result = await resolveMicrositeHost(db as never, {
        host: 'borradh.io',
        path: '/pricing',
      });

      expect(result.success).toBe(false);
      expect(redis().get).not.toHaveBeenCalled();
      expect(redis().set).not.toHaveBeenCalled();
    });

    /** A Redis outage degrades to an uncached resolve — never to a dead tenant site. */
    it('resolves from the database when Redis is down', async () => {
      redis().get.mockRejectedValueOnce(new Error('ECONNRESET'));
      redis().set.mockRejectedValueOnce(new Error('ECONNRESET'));
      db.query.microsite.findFirst.mockResolvedValue(siteColumns);

      const result = await resolveMicrositeHost(db as never, {
        host: 'acme-salon.borradh.io',
      });

      expect(result.success).toBe(true);
    });
  });
});
