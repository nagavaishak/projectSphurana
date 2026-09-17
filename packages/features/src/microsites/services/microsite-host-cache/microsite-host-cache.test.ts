import { getRedis } from '@borradh-workspace/redis';
/**
 * The cache in front of the hottest path in the feature.
 *
 * What is pinned here is not "Redis works" but the two things that hurt in
 * production: the KEY SHAPE (the path tier must not key on the host alone, or
 * one tenant's site is served on another's URL) and the BUST COVERAGE (a bust
 * that misses a key is a tenant serving stale content, or a removed domain
 * still resolving, for a full TTL).
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { type MockDb, createMockDb } from '../shared/mock-db.test-utils.js';
import {
  MICROSITE_HOST_CACHE_TTL_SECONDS,
  MICROSITE_HOST_MISS_TTL_SECONDS,
  bustMicrositeHostCacheForHosts,
  bustMicrositeHostCacheForMicrosite,
  micrositeHostCacheKey,
  readMicrositeHostCache,
  writeMicrositeHostCache,
} from './microsite-host-cache.js';

const redis = () => vi.mocked(getRedis)();

let db: MockDb;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('MICROSITE_BASE_DOMAIN', 'borradh.io');
  db = createMockDb();
  db.query.micrositeDomain.findMany.mockResolvedValue([]);
});

afterEach(() => vi.unstubAllEnvs());

describe('micrositeHostCacheKey', () => {
  it('keys a host tier on the normalised host', () => {
    expect(micrositeHostCacheKey('ACME.borradh.io:443')).toBe(
      'microsite:host:acme.borradh.io'
    );
  });

  /**
   * The path tier serves EVERY tenant from one apex. Keying on the host alone
   * would hand the second visitor the first visitor's microsite.
   */
  it('keys the path tier on host AND slug', () => {
    expect(micrositeHostCacheKey('borradh.io', 'acme')).toBe(
      'microsite:host:borradh.io:/sites/acme'
    );
    expect(micrositeHostCacheKey('borradh.io', 'acme')).not.toBe(
      micrositeHostCacheKey('borradh.io', 'other')
    );
  });
});

describe('readMicrositeHostCache', () => {
  it('returns the cached value on a hit', async () => {
    redis().get.mockResolvedValueOnce(JSON.stringify({ slug: 'acme' }));

    const result = await readMicrositeHostCache<{ slug: string }>('k');

    expect(result).toEqual({ kind: 'hit', value: { slug: 'acme' } });
  });

  it('distinguishes a cached miss from no entry at all', async () => {
    redis().get.mockResolvedValueOnce('__miss__');
    expect(await readMicrositeHostCache('k')).toEqual({ kind: 'miss' });

    redis().get.mockResolvedValueOnce(null);
    expect(await readMicrositeHostCache('k')).toEqual({ kind: 'empty' });
  });

  /** A Redis outage must degrade to an uncached resolve, never to a failure. */
  it('reports empty when Redis throws', async () => {
    redis().get.mockRejectedValueOnce(new Error('ECONNRESET'));

    expect(await readMicrositeHostCache('k')).toEqual({ kind: 'empty' });
  });

  it('reports empty on a poisoned (unparseable) value', async () => {
    redis().get.mockResolvedValueOnce('{not json');

    expect(await readMicrositeHostCache('k')).toEqual({ kind: 'empty' });
  });
});

describe('writeMicrositeHostCache', () => {
  it('writes a hit at the 5 minute TTL', async () => {
    await writeMicrositeHostCache('k', { slug: 'acme' });

    expect(redis().set).toHaveBeenCalledWith(
      'k',
      JSON.stringify({ slug: 'acme' }),
      'EX',
      MICROSITE_HOST_CACHE_TTL_SECONDS
    );
  });

  /**
   * The negative entry is what stops scanner traffic from being one database
   * query per request — and its TTL is shorter because it is the entry that can
   * make a newly valid host look dead.
   */
  it('writes a miss at the shorter TTL', async () => {
    await writeMicrositeHostCache('k', null);

    expect(redis().set).toHaveBeenCalledWith(
      'k',
      '__miss__',
      'EX',
      MICROSITE_HOST_MISS_TTL_SECONDS
    );
    expect(MICROSITE_HOST_MISS_TTL_SECONDS).toBeLessThan(
      MICROSITE_HOST_CACHE_TTL_SECONDS
    );
  });

  it('swallows a Redis failure', async () => {
    redis().set.mockRejectedValueOnce(new Error('READONLY'));

    await expect(
      writeMicrositeHostCache('k', { slug: 'acme' })
    ).resolves.toBeUndefined();
  });
});

describe('bustMicrositeHostCacheForHosts', () => {
  it('busts both the apex and the www form of every host', async () => {
    await bustMicrositeHostCacheForHosts(['Salon.com', 'www.other.com']);

    const keys = redis().del.mock.calls[0];
    expect(new Set(keys)).toEqual(
      new Set([
        'microsite:host:salon.com',
        'microsite:host:www.salon.com',
        'microsite:host:other.com',
        'microsite:host:www.other.com',
      ])
    );
  });

  it('does not call Redis when there is nothing to bust', async () => {
    await bustMicrositeHostCacheForHosts([]);

    expect(redis().del).not.toHaveBeenCalled();
  });
});

describe('bustMicrositeHostCacheForMicrosite', () => {
  it('busts the wildcard, path and custom-domain keys together', async () => {
    vi.stubEnv('MICROSITE_BASE_DOMAIN', 'borradh.io,borradh.site');
    db.query.micrositeDomain.findMany.mockResolvedValue([
      { domain: 'salon.com' },
    ]);

    await bustMicrositeHostCacheForMicrosite(db as never, {
      micrositeId: 'site-1',
      slug: 'acme',
    });

    const keys = new Set(redis().del.mock.calls[0]);
    expect(keys).toEqual(
      new Set([
        'microsite:host:acme.borradh.io',
        'microsite:host:borradh.io:/sites/acme',
        'microsite:host:acme.borradh.site',
        'microsite:host:borradh.site:/sites/acme',
        'microsite:host:salon.com',
        'microsite:host:www.salon.com',
      ])
    );
  });

  /**
   * A domain that has just been deactivated is exactly the row whose cached HIT
   * has to go, so the read is not filtered by status.
   */
  it('reads domain rows at every status', async () => {
    await bustMicrositeHostCacheForMicrosite(db as never, {
      micrositeId: 'site-1',
      slug: 'acme',
    });

    const args = db.query.micrositeDomain.findMany.mock.calls[0]?.[0] as {
      columns: unknown;
    };
    expect(args.columns).toEqual({ domain: true });
  });

  it('still busts the platform keys when the domain read fails', async () => {
    db.query.micrositeDomain.findMany.mockRejectedValue(new Error('db down'));

    await bustMicrositeHostCacheForMicrosite(db as never, {
      micrositeId: 'site-1',
      slug: 'acme',
    });

    expect(new Set(redis().del.mock.calls[0])).toEqual(
      new Set([
        'microsite:host:acme.borradh.io',
        'microsite:host:borradh.io:/sites/acme',
      ])
    );
  });
});
