export {
  MICROSITE_HOST_CACHE_TTL_SECONDS,
  MICROSITE_HOST_MISS_TTL_SECONDS,
  bustMicrositeHostCacheForHosts,
  bustMicrositeHostCacheForMicrosite,
  micrositeBaseDomains,
  micrositeHostCacheKey,
  normalizeHost,
  readMicrositeHostCache,
  writeMicrositeHostCache,
  type MicrositeHostCacheRead,
} from './microsite-host-cache.js';
