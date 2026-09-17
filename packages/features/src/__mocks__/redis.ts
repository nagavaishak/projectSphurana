/**
 * Canonical mock for @borradh-workspace/redis.
 *
 * Aliased in vite.config.ts so the real Redis/BullMQ connection is never
 * opened in tests, and so every test file sees the *same* mock — a prerequisite
 * for `isolate: false`. See docs/plans/features-test-suite-speedup.md.
 *
 * Test files should NOT `vi.mock('@borradh-workspace/redis')` — import the
 * symbol and drive it with `vi.mocked()`. `beforeEach(vi.clearAllMocks())`
 * resets call history between tests.
 */
import { vi } from 'vitest';

// Any method access on the client returns a stable vi.fn(), so tests can do
// e.g. `vi.mocked(getRedis)().set.mockResolvedValueOnce('OK')` without this
// mock having to enumerate ioredis's full API surface.
const clientFns = new Map<string, ReturnType<typeof vi.fn>>();
export const mockRedisClient = new Proxy(
  {} as Record<string, ReturnType<typeof vi.fn>>,
  {
    get(_target, prop: string) {
      let fn = clientFns.get(prop);
      if (!fn) {
        fn = vi.fn();
        clientFns.set(prop, fn);
      }
      return fn;
    },
  }
);

export const getRedis = vi.fn(() => mockRedisClient);
export const redis = mockRedisClient;
export const testConnection = vi.fn(async () => true);
export const disconnect = vi.fn(async () => undefined);
export const getBullMqPrefix = vi.fn((): string | undefined => undefined);
