import { getRedis } from '@borradh-workspace/redis';

/**
 * The Redis client, or `null` when Redis is not configured on this deployment.
 *
 * `getRedis()` THROWS when unconfigured, so every caller that treats Redis as
 * optional wrapped it in the same silent try/catch. Naming it once means the
 * "optional" part is stated rather than inferred from an empty catch block.
 */
export function tryGetRedis(): ReturnType<typeof getRedis> | null {
  try {
    return getRedis();
  } catch {
    /* Redis not configured */
    return null;
  }
}
