import { beforeEach, describe, expect, it } from 'vitest';
import { GRAPH_API_BASE } from '../../shared/graph-api.js';
import { createMetaFakeInterceptor } from './index.js';
import {
  type FakeStoreBackend,
  type FakeStoreRedisLike,
  createRedisFakeStore,
  fakeStoreKey,
  setFakeStoreBackend,
} from './store.js';

/**
 * The bug this file exists for: the store was a module-level Map, and
 * `e2e-app.yml` scales the preview API to TWO machines for the test window.
 * `ensureCampaign` created on one, the next list landed on the other and
 * reported none, so it created another — and the suite saw a campaign list that
 * was empty, then held one, then three duplicates of the same name. Three
 * different spec failures, one cause, none of them naming it.
 *
 * WHAT CAN AND CANNOT BE PROVEN HERE
 * ----------------------------------
 * Two interceptors in ONE process is not two machines: `setFakeStoreBackend`
 * sets a module-level backend they both read, so a cross-machine test written
 * that way passes against the in-memory store too and proves nothing. (Written
 * that way first, and checked — it passed with a plain Map.)
 *
 * The property is therefore tested where it actually lives: two INDEPENDENT
 * store instances over one Redis, which is what two processes have. Those fail
 * against separate in-memory Maps, because that is precisely the bug.
 */

/** An in-process stand-in for ioredis: same commands, no socket. */
class FakeRedis implements FakeStoreRedisLike {
  private readonly hashes = new Map<string, Map<string, string>>();

  private hash(key: string): Map<string, string> {
    const existing = this.hashes.get(key);
    if (existing) return existing;
    const created = new Map<string, string>();
    this.hashes.set(key, created);
    return created;
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.hash(key).get(field) ?? null;
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    this.hash(key).set(field, value);
    return 1;
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    for (const f of fields) this.hash(key).delete(f);
    return fields.length;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return Object.fromEntries(this.hash(key));
  }

  async del(key: string): Promise<number> {
    this.hashes.delete(key);
    return 1;
  }

  async expire(): Promise<number> {
    return 1;
  }
}

const campaign = (id: string, name: string) => ({
  id,
  kind: 'campaign' as const,
  ownerId: 'act_shared',
  fields: { id, name, status: 'PAUSED' },
});

describe('the store is shared between processes', () => {
  // Two backend instances over one Redis = the API's two machines, or the API
  // and the worker. Each has its OWN object; only Redis is common.
  let machineA: FakeStoreBackend;
  let machineB: FakeStoreBackend;

  beforeEach(() => {
    const redis = new FakeRedis();
    machineA = createRedisFakeStore(redis);
    machineB = createRedisFakeStore(redis);
  });

  it('reads on B what A wrote', async () => {
    await machineA.put(campaign('camp-1', 'Cross-machine Campaign'));

    expect((await machineB.get('camp-1'))?.fields.name).toBe(
      'Cross-machine Campaign'
    );
  });

  it('lists on B what A created', async () => {
    await machineA.put(campaign('camp-2', 'Listed Across'));

    expect((await machineB.all()).map((o) => o.id)).toContain('camp-2');
  });

  it('propagates a delete from B back to A', async () => {
    await machineA.put(campaign('camp-3', 'Deleted Across'));
    await machineB.remove('camp-3');

    expect(await machineA.get('camp-3')).toBeUndefined();
  });

  it('lets a seed-if-absent check converge instead of duplicating', async () => {
    // `ensureCampaign` lists, and creates only when it finds nothing. With a
    // per-process store the list on the OTHER machine always found nothing, so
    // every retry minted another campaign under the same name — which is what
    // produced the strict-mode violation on three identical options.
    const seedIfAbsent = async (store: FakeStoreBackend, n: number) => {
      const existing = await store.all();
      if (existing.some((o) => o.fields.name === 'E2E Seed')) return;
      await store.put(campaign(`camp-seed-${n}`, 'E2E Seed'));
    };

    await seedIfAbsent(machineA, 1);
    await seedIfAbsent(machineB, 2);
    await seedIfAbsent(machineA, 3);

    // Count DISTINCT ids across both machines, not what one of them holds:
    // with a per-process store each machine ends up holding exactly one seed
    // of its own, so a single-machine assertion passes while the org actually
    // has two.
    const ids = new Set(
      [...(await machineA.all()), ...(await machineB.all())]
        .filter((o) => o.fields.name === 'E2E Seed')
        .map((o) => o.id)
    );
    expect([...ids]).toHaveLength(1);
  });
});

describe('stacks on the same Redis are isolated by namespace', () => {
  /**
   * The second half of the sharing story. Every PR preview is handed the SAME
   * `REDIS_URL`, while `meta_campaign_config` stays in that PR's own Neon
   * branch — so a shared hash means one stack's cleanup deletes another's
   * campaigns and leaves its own, which the victim then lists from "Meta" with
   * no local config and renders as "No campaigns created yet".
   */
  // A fresh Redis per test — a shared one would let an earlier test's objects
  // masquerade as isolation working (or failing).
  let redis: FakeRedis;
  beforeEach(() => {
    redis = new FakeRedis();
  });

  it('keys unnamespaced and namespaced stores apart', () => {
    expect(fakeStoreKey()).toBe('meta-contract-fake:objects');
    expect(fakeStoreKey('pr-881')).toBe('meta-contract-fake:objects:pr-881');
    // An empty/blank prefix (staging, prod, a local run) is not a namespace.
    expect(fakeStoreKey('  ')).toBe('meta-contract-fake:objects');
  });

  it('does not show one stack the other stack’s campaigns', async () => {
    const prA = createRedisFakeStore(redis, { namespace: 'pr-881' });
    const prB = createRedisFakeStore(redis, { namespace: 'pr-882' });

    await prA.put(campaign('camp-a', 'E2E Leads Chatbot Campaign'));
    await prB.put(campaign('camp-b', 'E2E Leads Chatbot Campaign'));

    expect((await prA.all()).map((o) => o.id)).toEqual(['camp-a']);
    expect((await prB.all()).map((o) => o.id)).toEqual(['camp-b']);
  });

  it("survives the other stack's /^e2e/ cleanup", async () => {
    // Exactly what run 32467346227 did to run 32467004529: listed every E2E
    // campaign it could see and deleted them, then seeded its own.
    const prA = createRedisFakeStore(redis, { namespace: 'pr-881' });
    const prB = createRedisFakeStore(redis, { namespace: 'pr-882' });

    await prA.put(campaign('camp-319c', 'E2E Leads Chatbot Campaign'));

    for (const o of await prB.all()) await prB.remove(o.id);
    await prB.put(campaign('camp-f36c', 'E2E Leads Chatbot Campaign'));

    expect((await prA.all()).map((o) => o.id)).toEqual(['camp-319c']);
  });

  it('still shares within one stack, across its processes', async () => {
    // The namespace must not undo the property the rest of this file proves:
    // the API's two machines and the worker are one stack.
    const machineA = createRedisFakeStore(redis, { namespace: 'pr-881' });
    const machineB = createRedisFakeStore(redis, { namespace: 'pr-881' });

    await machineA.put(campaign('camp-same-stack', 'Shared Within Stack'));

    expect((await machineB.get('camp-same-stack'))?.fields.name).toBe(
      'Shared Within Stack'
    );
  });
});

describe('the fake serves its endpoints over the shared store', () => {
  // Separate concern from the one above: that the Redis-backed store is a
  // working backend for the fake at all, not that it spans processes.
  const fake = createMetaFakeInterceptor();

  beforeEach(() => {
    setFakeStoreBackend(createRedisFakeStore(new FakeRedis()));
  });

  it('creates, lists and reads back through Redis', async () => {
    const post = await fake(`${GRAPH_API_BASE}/act_redis/campaigns`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Redis Campaign',
        objective: 'OUTCOME_LEADS',
        status: 'PAUSED',
        special_ad_categories: [],
        buying_type: 'AUCTION',
        is_adset_budget_sharing_enabled: false,
      }),
    });
    const { id } = (await post?.json()) as { id: string };

    const list = await fake(
      `${GRAPH_API_BASE}/act_redis/campaigns?fields=id,name`,
      {}
    );
    const listed = (await list?.json()) as {
      data: Array<{ id: string; name: string }>;
    };

    expect(listed.data.map((c) => c.id)).toContain(id);
    expect(listed.data[0]?.name).toBe('Redis Campaign');
  });
});
