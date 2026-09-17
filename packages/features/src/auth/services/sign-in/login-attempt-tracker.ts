import { createLogger } from '@borradh-workspace/observability';
import { getRedis } from '@borradh-workspace/redis';

const logger = createLogger('LoginAttemptTracker');
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_SECONDS = 30 * 60; // 30 minutes
const ATTEMPT_WINDOW_SECONDS = 15 * 60; // 15 minute window

function getKey(email: string) {
  return `login_attempts:${email.toLowerCase()}`;
}

function getLockKey(email: string) {
  return `login_lock:${email.toLowerCase()}`;
}

function tryGetRedis() {
  try {
    return getRedis();
  } catch {
    // Redis not available (e.g., dev without REDIS_URL) — skip lockout
    return null;
  }
}

export async function isAccountLocked(
  email: string
): Promise<{ locked: boolean; minutesRemaining?: number }> {
  const redis = tryGetRedis();
  if (!redis) return { locked: false };

  const lockTtl = await redis.ttl(getLockKey(email));
  if (lockTtl > 0) {
    return { locked: true, minutesRemaining: Math.ceil(lockTtl / 60) };
  }
  return { locked: false };
}

export async function recordFailedAttempt(email: string): Promise<void> {
  const redis = tryGetRedis();
  if (!redis) return;

  const key = getKey(email);
  const attempts = await redis.incr(key);
  if (attempts === 1) {
    await redis.expire(key, ATTEMPT_WINDOW_SECONDS);
  }

  if (attempts >= MAX_ATTEMPTS) {
    await redis.set(getLockKey(email), '1', 'EX', LOCKOUT_DURATION_SECONDS);
    await redis.del(key);
    logger.warn(`Account locked due to ${MAX_ATTEMPTS} failed login attempts`, {
      email,
    });
  }
}

export async function clearFailedAttempts(email: string): Promise<void> {
  const redis = tryGetRedis();
  if (!redis) return;
  await redis.del(getKey(email));
}
