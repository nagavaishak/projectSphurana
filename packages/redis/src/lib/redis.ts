import { Redis } from 'ioredis';

// Consumers hold the client this package hands them (`getRedis()`), so they need
// its type. Re-exported here because ioredis is this package's dependency, not
// theirs: under pnpm's strict isolation an app that imports 'ioredis' directly
// resolves nothing.
export type { Redis } from 'ioredis';

// Lazy-initialized Redis client
let _redis: Redis | null = null;

/**
 * Get the Redis client instance.
 * The client is lazily initialized on first access to ensure
 * environment variables are loaded before connection.
 */
export function getRedis(): Redis {
  if (!_redis) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error(
        'REDIS_URL environment variable is not set. ' +
          'Make sure your .env file is loaded before importing the redis module.'
      );
    }

    _redis = new Redis(redisUrl, {
      // Must be null for BullMQ compatibility (blocking commands)
      maxRetriesPerRequest: null,
      retryStrategy(times: number) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      // Detect and recover from stale TCP connections (NAT gateway idle timeout)
      keepAlive: 10000, // Send TCP keepalive probe every 10s
      connectTimeout: 10000, // Fail fast if connection can't be established in 10s
      enableOfflineQueue: true, // Queue commands while reconnecting
      // Force a full reconnect when a command fails with a severed-socket error.
      // Fly's NAT silently drops idle connections during/after slow work; the
      // socket goes half-open and the next command surfaces "other side closed"
      // / ECONNRESET / "Connection is closed". Without this, a blocking BullMQ
      // command (BRPOPLPUSH) can wedge on the dead socket and the worker stops
      // draining the queue. Returning true reconnects and replays the command.
      reconnectOnError(err: Error) {
        const msg = err.message;
        if (
          /other side closed|ECONNRESET|EPIPE|Connection is closed|read ECONNRESET/i.test(
            msg
          )
        ) {
          return true;
        }
        return false;
      },
    });

    _redis.on('error', (err: Error) => {
      console.error('Redis connection error:', err);
    });
  }
  return _redis;
}

// For backwards compatibility - lazily access redis
export const redis = new Proxy({} as Redis, {
  get(_target, prop) {
    return (getRedis() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

/**
 * Test the Redis connection
 * @returns true if connection is successful
 * @throws Error if connection fails
 */
export async function testConnection(): Promise<boolean> {
  const client = getRedis();
  const result = await client.ping();
  if (result !== 'PONG') {
    throw new Error(`Unexpected Redis ping response: ${result}`);
  }
  return true;
}

/**
 * Close the Redis connection
 */
export async function disconnect(): Promise<void> {
  if (_redis) {
    await _redis.quit();
    _redis = null;
  }
}

/**
 * Transient Redis connection errors that ioredis recovers from on its own
 * via `retryStrategy`. These fire as `error` events on the client and on
 * BullMQ workers; logging each one to Sentry produces high-volume noise
 * (see ENG-51: hundreds of `connect ETIMEDOUT` events) for a condition that
 * self-heals. Callers should downgrade these to a warn.
 */
const TRANSIENT_REDIS_PATTERNS = [
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'EAI_AGAIN',
  'ENOTFOUND',
  'Connection is closed',
  'Command timed out',
  'connect ETIMEDOUT',
];

/**
 * Transient *server-side* errors surfaced by Upstash as Redis `ReplyError`s
 * (not connection-level — they come back ON a live socket as an `-ERR ...`
 * reply). They arrive on the shared BullMQ connection while Upstash is doing
 * a managed upgrade/failover, throttling, or tearing down a slow caller's
 * Lua script, and they all self-heal: the next command (or BullMQ's own
 * retry/stalled recovery) succeeds. Logging each to Sentry at `error` level
 * is pure noise across every worker at once (see API-58 / ENG-251).
 *
 * Matched case-insensitively against the reply message:
 * - `Error running script: execution timed out` — our Lua command outlived
 *   Upstash's `lua-time-limit` because the shared connection was saturated;
 *   BullMQ retries the move-to-active.
 * - `caller gone` — Upstash aborted a Lua script whose calling connection
 *   dropped mid-execution.
 * - `READONLY Writes are temporarily rejected ...` — Upstash failover /
 *   server upgrade / migration; the replica isn't writable yet.
 * - `Server is stopping` — Upstash node shutting down during an upgrade.
 * - `max requests limit exceeded` — Upstash plan request cap; warn loudly
 *   (a human may need to upgrade the plan) but don't page.
 */
const TRANSIENT_REDIS_REPLY_PATTERNS = [
  'execution timed out',
  'caller gone',
  'readonly',
  'server is stopping',
  'max requests limit exceeded',
];

export function isTransientRedisError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  if (code && TRANSIENT_REDIS_PATTERNS.includes(code)) return true;
  if (
    TRANSIENT_REDIS_PATTERNS.some((pattern) => error.message.includes(pattern))
  ) {
    return true;
  }
  // Upstash server-side ReplyErrors (case-insensitive — Upstash varies casing).
  const lowerMessage = error.message.toLowerCase();
  return TRANSIENT_REDIS_REPLY_PATTERNS.some((pattern) =>
    lowerMessage.includes(pattern)
  );
}

// Export types
export type RedisClient = Redis;
