import { createLogger } from '@borradh-workspace/observability';
import { getRedis } from '@borradh-workspace/redis';

const logger = createLogger('ConversationLock');

export interface ConversationLock {
  acquired: boolean;
  release: () => Promise<void>;
}

/**
 * Acquire a per-conversation Redis lock to prevent concurrent AI execution.
 * Uses SET NX PX for atomic acquire with TTL.
 *
 * PRD-40: the default TTL must exceed the worst-case AI turn AND the chatbot
 * worker's BullMQ `lockDuration` (120s). If the lock expired mid-turn, BullMQ
 * stalled-recovery (or a retry) could pick the same conversation up on another
 * worker and run it twice. 180s leaves headroom above a slow GPT turn + tool
 * calls + multi-part delivery while still self-healing if a worker dies.
 */
export async function acquireConversationLock(
  conversationId: string,
  ttlMs = 180000
): Promise<ConversationLock> {
  const redis = getRedis();
  const lockKey = `conversation-lock:${conversationId}`;
  const lockValue = `${process.pid}-${Date.now()}`;

  const result = await redis.set(lockKey, lockValue, 'PX', ttlMs, 'NX');

  if (result !== 'OK') {
    return { acquired: false, release: async () => {} };
  }

  logger.info('Lock acquired', { conversationId });

  return {
    acquired: true,
    release: async () => {
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      try {
        await redis.eval(script, 1, lockKey, lockValue);
        logger.info('Lock released', { conversationId });
      } catch {
        logger.warn('Failed to release lock', { conversationId });
      }
    },
  };
}
