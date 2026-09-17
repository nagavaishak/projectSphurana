import type { ThrottlerStorage } from '@nestjs/throttler';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}
import { getRedis } from '@borradh-workspace/redis';

const KEY_PREFIX = 'throttle';

/**
 * Redis-backed storage for @nestjs/throttler.
 * Uses the existing ioredis client from @borradh-workspace/redis
 * so rate limits are shared across all API instances.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    _throttlerName: string
  ): Promise<ThrottlerStorageRecord> {
    // Skip rate limiting in non-production or staging with E2E enabled
    if (process.env.NODE_ENV !== 'production' || process.env.E2E_SEED_TOKEN) {
      return {
        totalHits: 1,
        timeToExpire: 0,
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }

    const ttlSeconds = Math.ceil(ttl / 1000);
    const redisKey = `${KEY_PREFIX}:${key}`;
    const blockKey = `${redisKey}:blocked`;

    try {
      const redis = getRedis();

      // Check if currently blocked
      const isBlocked = await redis.exists(blockKey);
      if (isBlocked) {
        const timeToBlockExpire = await redis.ttl(blockKey);
        const totalHits = Number.parseInt(
          (await redis.get(redisKey)) || '0',
          10
        );
        return {
          totalHits,
          timeToExpire: ttlSeconds,
          isBlocked: true,
          timeToBlockExpire,
        };
      }

      // Increment counter
      const totalHits = await redis.incr(redisKey);

      // Set expiration on first hit
      if (totalHits === 1) {
        await redis.expire(redisKey, ttlSeconds);
      }

      const timeToExpire = await redis.ttl(redisKey);

      // Block if limit exceeded
      if (totalHits > limit && blockDuration > 0) {
        await redis.setex(blockKey, Math.ceil(blockDuration / 1000), '1');
        return {
          totalHits,
          timeToExpire,
          isBlocked: true,
          timeToBlockExpire: Math.ceil(blockDuration / 1000),
        };
      }

      return {
        totalHits,
        timeToExpire,
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    } catch (error) {
      // Fail OPEN: a Redis blip must not 500 every request. Rate limiting is a
      // safeguard, not a hard dependency — allow the request and log once.
      console.error(
        '[RedisThrottlerStorage] Redis unavailable, allowing request (fail-open):',
        error instanceof Error ? error.message : String(error)
      );
      return {
        totalHits: 1,
        timeToExpire: ttlSeconds,
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }
}
