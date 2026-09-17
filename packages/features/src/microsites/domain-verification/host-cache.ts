/**
 * Host-cache invalidation (contract §3).
 *
 * The renderer resolves `Host` through `microsite:host:{host}` with a 5-minute
 * TTL. Every transition in this folder that changes what a host resolves to —
 * activation, a primary flip, a give-up — has to drop those keys, or a tenant
 * whose domain just went live keeps getting a 404 for five more minutes and
 * reports it as an outage.
 *
 * Best-effort by design: a cache bust that throws must not roll back the
 * activation that earned it. The TTL is the backstop.
 */

import { createLogger } from '@borradh-workspace/observability';
import { getRedis } from '@borradh-workspace/redis';
import { HOST_CACHE_KEY } from './domain-verification.constants.js';

const logger = createLogger('MicrositeHostCache');

/** Drop the cached resolution for each host. Never throws. */
export const bustMicrositeHostCache = async (
  hosts: readonly (string | null | undefined)[]
): Promise<void> => {
  const keys = [
    ...new Set(
      hosts
        .filter((h): h is string => typeof h === 'string' && h.length > 0)
        .flatMap((h) => [h, h.startsWith('www.') ? h.slice(4) : `www.${h}`])
    ),
  ].map(HOST_CACHE_KEY);

  if (keys.length === 0) return;

  try {
    await getRedis().del(...keys);
  } catch (error) {
    // Swallowed deliberately — see the file header.
    logger.warn('Failed to bust microsite host cache', {
      keyCount: keys.length,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
};
