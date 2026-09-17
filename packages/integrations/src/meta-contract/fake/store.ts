/**
 * The fake's Marketing-API object graph.
 *
 * WHY THIS EXISTS (and why it is the ONLY stateful part of the fake)
 * -----------------------------------------------------------------
 * Everything else in the fake derives or mints its answer from the request
 * alone. That works because nothing reads those objects back by enumeration.
 * The Marketing API is different: our product LISTS.
 *
 * `list-campaigns.service.ts` makes Meta's `GET /act_x/campaigns` the SPINE of
 * the campaign list — local `meta_campaign_config` rows only enrich it — and
 * `list-ads.service.ts` does the same through `GET /{campaignId}/ads`. A list
 * cannot be derived from the request that asks for it, so the fake remembers
 * what it created, and only that.
 *
 * WHY IT IS SHARED, NOT PROCESS-LOCAL
 * -----------------------------------
 * The first version kept a module-level Map, on the reasoning that the process
 * which creates a campaign is the one that lists it. That is false in the only
 * environment that matters: `e2e-app.yml` scales the preview API to TWO
 * machines for the test window, and requests are load-balanced across them.
 *
 * The failure was not a crash. `ensureCampaign` created on machine A, the next
 * list landed on B and reported none, so it created another — and the suite saw
 * a campaign list that was empty, then held one, then three duplicates of the
 * same name, depending on which machine answered. Specs failed with
 * "produced no E2E campaign", "(none)", and a strict-mode violation on three
 * identical options, all from the same root cause and none of them naming it.
 * The worker is a third process with the same problem.
 *
 * So the backend is injectable and the host supplies a shared one. Default is
 * in-memory, which is correct for unit tests, the integration harness, and any
 * single-process run; the API and worker install the Redis backend at startup.
 */

export type FakeObjectKind =
  | 'campaign'
  | 'adset'
  | 'ad'
  | 'creative'
  | 'leadgenForm';

export interface FakeObject {
  id: string;
  kind: FakeObjectKind;
  /** `act_…` for ad objects; the page id for lead-gen forms. */
  ownerId: string;
  /** Direct Graph parent — adset→campaign, ad→adset. */
  parentId?: string;
  /** The node body as Graph would return it (`id`, `name`, `status`, …). */
  fields: Record<string, unknown>;
}

/**
 * Where the object graph lives. Async because the real one is over a socket.
 */
export interface FakeStoreBackend {
  get(id: string): Promise<FakeObject | undefined>;
  put(object: FakeObject): Promise<void>;
  remove(id: string): Promise<void>;
  all(): Promise<FakeObject[]>;
  clear(): Promise<void>;
}

class InMemoryFakeStore implements FakeStoreBackend {
  private readonly objects = new Map<string, FakeObject>();

  async get(id: string): Promise<FakeObject | undefined> {
    return this.objects.get(id);
  }

  async put(object: FakeObject): Promise<void> {
    this.objects.set(object.id, object);
  }

  async remove(id: string): Promise<void> {
    this.objects.delete(id);
  }

  async all(): Promise<FakeObject[]> {
    return [...this.objects.values()];
  }

  async clear(): Promise<void> {
    this.objects.clear();
  }
}

/**
 * The subset of ioredis the store needs.
 *
 * Declared structurally so `packages/integrations` needs no Redis dependency —
 * the host passes its existing client (`getRedis()`), which already satisfies
 * this shape.
 */
export interface FakeStoreRedisLike {
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, field: string, value: string): Promise<unknown>;
  hdel(key: string, ...fields: string[]): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string>>;
  del(key: string): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
}

/** One preview stack's objects live under one hash, and expire with it. */
const DEFAULT_KEY = 'meta-contract-fake:objects';
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

/**
 * The hash one stack's objects live under.
 *
 * WHY THE NAMESPACE IS NOT OPTIONAL IN PREVIEW
 * --------------------------------------------
 * Every PR preview gets the SAME `REDIS_URL` (1Password `preview-env`), so an
 * un-namespaced key put every open PR's fake Marketing API into one hash —
 * while `meta_campaign_config` stayed in each PR's own Neon branch. Two
 * overlapping `connected-ads` runs then did this to each other:
 *
 *   PR A seeds "E2E Leads Chatbot Campaign" (camp-319c) + its config row.
 *   PR B's `cleanupE2ECampaignsAndAds()` deletes every /^e2e/ campaign it can
 *     see — including camp-319c — and seeds its own camp-f36c.
 *   PR A now lists camp-f36c from Meta with NO local config, so the ad
 *     wizard's `campaigns.filter(c => !!c.followUpType)` drops it and renders
 *     "No campaigns created yet".
 *
 * That is a real run: `launch-and-delete-ad` and `launch-leads-chatbot-ad`
 * both failed on it while the specs that seed their own config-bearing
 * campaign passed in the same job. The ad account is shared too, so the fake
 * cannot tell the stacks apart by owner — only the key can.
 *
 * `BULLMQ_KEY_PREFIX` (`pr-123` on a preview, unset on staging/prod) already
 * names the stack for the same shared Upstash instance; reusing it keeps one
 * notion of "which stack am I" rather than inventing a second.
 */
export function fakeStoreKey(namespace?: string): string {
  const ns = namespace?.trim();
  return ns ? `${DEFAULT_KEY}:${ns}` : DEFAULT_KEY;
}

/**
 * A Redis-backed store, shared by every process pointed at the same instance.
 *
 * One HASH keyed by object id. `all()` reads the whole hash and filters in JS,
 * which is fine at test volumes (tens of objects) and keeps the store free of
 * secondary indexes that could disagree with it.
 *
 * The TTL is refreshed on write so a preview stack's objects age out on their
 * own — nothing here is worth a cleanup job.
 *
 * Pass `namespace` (the stack id) so concurrent preview stacks on the SAME
 * Redis cannot see — or delete — each other's objects. See `fakeStoreKey`.
 */
export function createRedisFakeStore(
  client: FakeStoreRedisLike,
  options: { key?: string; namespace?: string; ttlSeconds?: number } = {}
): FakeStoreBackend {
  const key = options.key ?? fakeStoreKey(options.namespace);
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;

  const parse = (raw: string | null): FakeObject | undefined => {
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as FakeObject;
    } catch {
      return undefined;
    }
  };

  return {
    async get(id) {
      return parse(await client.hget(key, id));
    },
    async put(object) {
      await client.hset(key, object.id, JSON.stringify(object));
      await client.expire(key, ttl);
    },
    async remove(id) {
      await client.hdel(key, id);
    },
    async all() {
      const raw = await client.hgetall(key);
      return Object.values(raw ?? {})
        .map(parse)
        .filter((o): o is FakeObject => o !== undefined);
    },
    async clear() {
      await client.del(key);
    },
  };
}

let backend: FakeStoreBackend = new InMemoryFakeStore();

/**
 * Point the fake at a shared store. Call once at startup, alongside
 * `installMetaContractInterceptor`.
 */
export function setFakeStoreBackend(next: FakeStoreBackend): void {
  backend = next;
}

export function recordFakeObject(object: FakeObject): Promise<void> {
  return backend.put(object);
}

export function getFakeObject(id: string): Promise<FakeObject | undefined> {
  return backend.get(id);
}

/** Shallow-merge onto a stored node. No-op when the id is unknown. */
export async function patchFakeObject(
  id: string,
  patch: Record<string, unknown>
): Promise<void> {
  const existing = await backend.get(id);
  if (!existing) return;
  await backend.put({
    ...existing,
    fields: { ...existing.fields, ...patch },
  });
}

export function deleteFakeObject(id: string): Promise<void> {
  return backend.remove(id);
}

export async function findFakeObjects(
  predicate: (object: FakeObject) => boolean
): Promise<FakeObject[]> {
  return (await backend.all()).filter(predicate);
}

/**
 * The campaign an ad belongs to, walking ad → ad set → campaign.
 *
 * `GET /{campaignId}/ads` asks for ads by CAMPAIGN, but an ad's only stored
 * parent is its ad set — the same indirection Graph has.
 */
export async function campaignIdOfAd(
  ad: FakeObject
): Promise<string | undefined> {
  if (!ad.parentId) return undefined;
  return (await backend.get(ad.parentId))?.parentId;
}

/** Test-only. Production code must never need to forget. */
export function resetFakeStore(): Promise<void> {
  return backend.clear();
}
