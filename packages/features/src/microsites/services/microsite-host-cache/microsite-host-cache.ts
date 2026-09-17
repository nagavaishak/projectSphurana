/**
 * The Redis cache in front of `resolveMicrositeHost` (Phase 4 contract §3).
 *
 * Host resolution runs on EVERY public request to EVERY tenant site, including
 * requests from hosts we do not control, so an uncached resolve is one database
 * query per request from the open internet. This module is that cache, and it
 * is deliberately a sibling of the service rather than part of it: the BUST
 * functions belong to the domain and publish flows, which must not import the
 * resolver.
 *
 * KEYS (contract §3)
 *   microsite:host:{host}                  host tiers — custom + `{slug}.borradh.io`
 *   microsite:host:{host}:/sites/{slug}    path tier — one apex serves every
 *                                          tenant, so the host alone is NOT a key
 *
 * NEGATIVE LOOKUPS ARE CACHED TOO, at a shorter TTL. An unknown host is the
 * common case — scanners hit every IP on the internet — and without this every
 * one of those is a database query. The short TTL is what bounds the damage
 * when a host becomes valid without a bust reaching us.
 *
 * FAILURE MODE: every Redis call is swallowed. A Redis outage must degrade this
 * to "resolve from the database every time", never to "the tenant's website is
 * down". That also means the cache is a no-op wherever REDIS_URL is unset.
 */

import { micrositeDomain } from '@borradh-workspace/database';
import { getRedis } from '@borradh-workspace/redis';
import { eq } from 'drizzle-orm';
import type { DbConnection } from '../../../shared/index.js';

/** A hit: 5 minutes (contract §3). Long enough to matter, short enough to bound a missed bust. */
export const MICROSITE_HOST_CACHE_TTL_SECONDS = 300;

/**
 * A miss: 60 seconds. Shorter on purpose — a negative entry is the one that can
 * make a freshly verified domain, or a newly created subdomain, look dead. 60s
 * is the ceiling on that even if no bust fires at all.
 */
export const MICROSITE_HOST_MISS_TTL_SECONDS = 60;

const KEY_PREFIX = 'microsite:host:';

/** Sentinel for a cached negative lookup. Not valid JSON, so it can never collide with a hit. */
const MISS_SENTINEL = '__miss__';

/** Lowercase, no scheme, no port, no trailing dot. */
export const normalizeHost = (raw: string): string =>
  raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.+$/, '');

/**
 * The apexes we own. Comma-separated so staging (`borradh-dev.com`) and the
 * `borradh.site` path host can be added without a code change.
 *
 * Lives here rather than in the service so the bust side can enumerate the
 * wildcard/path keys for a microsite without importing the resolver — which
 * would be an import cycle.
 */
export const micrositeBaseDomains = (): string[] =>
  (process.env.MICROSITE_BASE_DOMAIN ?? 'borradh.io')
    .split(',')
    .map((d) =>
      d
        .trim()
        .toLowerCase()
        .replace(/^\.+|\.+$/g, '')
    )
    .filter(Boolean);

/**
 * `pathSlug` is set ONLY for the path tier, where a single apex serves every
 * tenant and keying on the host alone would serve one tenant's site to another.
 */
export const micrositeHostCacheKey = (
  host: string,
  pathSlug?: string | null
): string =>
  pathSlug
    ? `${KEY_PREFIX}${normalizeHost(host)}:/sites/${pathSlug}`
    : `${KEY_PREFIX}${normalizeHost(host)}`;

/** What a read found: a cached resolution, a cached miss, or nothing. */
export type MicrositeHostCacheRead<T> =
  | { kind: 'hit'; value: T }
  | { kind: 'miss' }
  | { kind: 'empty' };

export const readMicrositeHostCache = async <T>(
  key: string
): Promise<MicrositeHostCacheRead<T>> => {
  try {
    const raw = await getRedis().get(key);
    if (!raw) return { kind: 'empty' };
    if (raw === MISS_SENTINEL) return { kind: 'miss' };
    return { kind: 'hit', value: JSON.parse(raw) as T };
  } catch {
    // Redis down, unset, or a poisoned value. Fall through to the database.
    return { kind: 'empty' };
  }
};

/** `value === null` caches the NEGATIVE lookup, at the shorter TTL. */
export const writeMicrositeHostCache = async (
  key: string,
  value: unknown | null
): Promise<void> => {
  try {
    const client = getRedis();
    if (value === null) {
      await client.set(
        key,
        MISS_SENTINEL,
        'EX',
        MICROSITE_HOST_MISS_TTL_SECONDS
      );
      return;
    }
    await client.set(
      key,
      JSON.stringify(value),
      'EX',
      MICROSITE_HOST_CACHE_TTL_SECONDS
    );
  } catch {
    // A cache we could not write is a slow request, not a failed one.
  }
};

const del = async (keys: string[]): Promise<void> => {
  if (keys.length === 0) return;
  try {
    await getRedis().del(...keys);
  } catch {
    // Swallowed, but note the cost: a bust that does not land leaves a tenant
    // on stale content, or a removed domain resolving, for up to the TTL above.
    // That ceiling is why the hit TTL is 5 minutes and not an hour.
  }
};

/** Both the apex and the `www.` form — resolution accepts either, and caches whichever was asked for. */
const hostPairKeys = (host: string): string[] => {
  const normalized = normalizeHost(host);
  if (!normalized) return [];
  const apex = normalized.startsWith('www.') ? normalized.slice(4) : normalized;
  return [micrositeHostCacheKey(apex), micrositeHostCacheKey(`www.${apex}`)];
};

/**
 * Bust specific hostnames.
 *
 * CALL THIS ON: domain add, domain remove, and any status change on a
 * `microsite_domain` row (`pending_dns`/`verifying` → `active` and back).
 * Adding a domain matters as much as removing one, because the domain was
 * almost certainly probed while it was still pending and is therefore sitting
 * in the cache as a NEGATIVE entry.
 */
export const bustMicrositeHostCacheForHosts = async (
  hosts: readonly string[]
): Promise<void> => {
  const keys = new Set<string>();
  for (const host of hosts) {
    for (const key of hostPairKeys(host)) keys.add(key);
  }
  await del([...keys]);
};

/**
 * Bust EVERY host that can serve one microsite: its `{slug}.{apex}` subdomain
 * and `{apex}/sites/{slug}` path key on every base domain we own, plus every
 * custom domain row attached to it.
 *
 * CALL THIS ON: publish (the cached value carries `status`, so an unbusted
 * publish leaves the site rendering as a draft for up to 5 minutes), slug
 * change, and `isPrimary` change.
 *
 * Domain rows are read at EVERY status, not just `active` — a row that has just
 * been deactivated is precisely the one whose cached hit must go.
 */
export const bustMicrositeHostCacheForMicrosite = async (
  db: DbConnection,
  input: { micrositeId: string; slug: string }
): Promise<void> => {
  const slug = input.slug.trim().toLowerCase();
  const keys = new Set<string>();

  if (slug) {
    for (const apex of micrositeBaseDomains()) {
      keys.add(micrositeHostCacheKey(`${slug}.${apex}`));
      keys.add(micrositeHostCacheKey(apex, slug));
    }
  }

  // The apex keys above cover production. They do NOT cover a path-tier entry
  // on any OTHER host — a Vercel preview, a localhost stack — because those
  // keys are `{host}:/sites/{slug}` and the host is unknown here. Nothing
  // invalidated those, ever: visit /sites/{slug} before the site exists (a
  // crawler will), and the miss outlives the site's creation. SCAN, not KEYS:
  // this runs on provision and publish, never per request.
  try {
    const redis = getRedis();
    let cursor = '0';
    do {
      const [next, found] = await redis.scan(
        cursor,
        'MATCH',
        `${KEY_PREFIX}*:/sites/${slug}`,
        'COUNT',
        100
      );
      cursor = next;
      for (const key of found) keys.add(key);
    } while (cursor !== '0');
  } catch {
    // Swallowed like every other cache operation here — a stale entry expires
    // on its own, and failing a publish over Redis is the worse trade.
  }

  let domains: { domain: string }[] = [];
  try {
    domains = await db.query.micrositeDomain.findMany({
      where: eq(micrositeDomain.micrositeId, input.micrositeId),
      columns: { domain: true },
    });
  } catch {
    // A failed read must not stop the wildcard/path keys above from being busted.
    domains = [];
  }

  for (const row of domains ?? []) {
    for (const key of hostPairKeys(row.domain)) keys.add(key);
  }

  await del([...keys]);
};
