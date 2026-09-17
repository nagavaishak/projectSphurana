import type Redis from 'ioredis';

const HASH_KEY = 'webhook-router:subscribers';

export interface Subscriber {
  id: string;
  url: string;
  expiresAt: number; // unix ms
  createdAt: number;
}

export class SubscriberStore {
  constructor(private redis: Redis) {}

  /**
   * Upsert by id (caller-supplied — usually the PR preview slug so the
   * subscription is idempotent and trivially deletable on PR teardown).
   */
  async upsert(
    id: string,
    url: string,
    ttlSeconds: number
  ): Promise<Subscriber> {
    const now = Date.now();
    const sub: Subscriber = {
      id,
      url,
      createdAt: now,
      expiresAt: now + ttlSeconds * 1000,
    };
    await this.redis.hset(HASH_KEY, id, JSON.stringify(sub));
    return sub;
  }

  async remove(id: string): Promise<boolean> {
    const removed = await this.redis.hdel(HASH_KEY, id);
    return removed > 0;
  }

  /**
   * Returns all non-expired subscribers. Stale entries are deleted lazily
   * here so we don't need a separate cleanup job.
   */
  async listActive(): Promise<Subscriber[]> {
    const raw = await this.redis.hgetall(HASH_KEY);
    const now = Date.now();
    const active: Subscriber[] = [];
    const expiredIds: string[] = [];

    for (const [id, value] of Object.entries(raw)) {
      try {
        const sub = JSON.parse(value) as Subscriber;
        if (sub.expiresAt > now) {
          active.push(sub);
        } else {
          expiredIds.push(id);
        }
      } catch {
        // Malformed entry — drop it
        expiredIds.push(id);
      }
    }

    if (expiredIds.length > 0) {
      await this.redis.hdel(HASH_KEY, ...expiredIds);
    }

    return active;
  }
}
