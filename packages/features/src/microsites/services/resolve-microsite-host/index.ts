export {
  normalizeHost,
  resolveMicrositeHost,
  type MicrositeHostTier,
  type ResolveMicrositeHostResult,
  type ResolvedMicrositeHost,
} from './resolve-microsite-host.service.js';
export {
  resolveMicrositeHostSchema,
  type ResolveMicrositeHostInput,
} from './resolve-microsite-host.schema.js';
/**
 * The Redis cache that sits in front of the resolver, re-exported here so a
 * caller needs one import.
 *
 * `bustMicrositeHostCacheForHosts(hosts)` — call on domain ADD, domain REMOVE
 * and any `microsite_domain` status change. Add matters as much as remove: the
 * host was almost certainly probed while pending and is cached as a NEGATIVE.
 *
 * `bustMicrositeHostCacheForMicrosite(db, { micrositeId, slug })` — call on
 * PUBLISH (the cached value carries `status`), slug change and `isPrimary`
 * change. Busts the wildcard, path and every custom-domain key for one
 * microsite in a single call.
 */
export {
  MICROSITE_HOST_CACHE_TTL_SECONDS,
  MICROSITE_HOST_MISS_TTL_SECONDS,
  bustMicrositeHostCacheForHosts,
  bustMicrositeHostCacheForMicrosite,
  micrositeHostCacheKey,
} from '../microsite-host-cache/index.js';
