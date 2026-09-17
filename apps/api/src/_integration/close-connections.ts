/**
 * setupFilesAfterEnv — closes the Redis connection opened during a test file.
 *
 * Booting a controller and exercising a write path can transitively construct a
 * BullMQ queue (e.g. a campaign launch → `enqueueCampaignSend`), which opens the
 * shared `getRedis()` ioredis singleton. That client's retryStrategy never gives
 * up, so once `global-teardown` stops the Redis testcontainer, the still-open
 * connection retries and emits `ECONNREFUSED` — Jest reports "Cannot log after
 * tests are done" and force-exits non-zero even though every assertion passed.
 *
 * Jest sandboxes each test file with its own module registry, so the singleton
 * is per-file: quitting it in a per-file `afterAll` (which runs before
 * `global-teardown` stops the container) closes every queue's connection, since
 * all queue-add paths share this one client via `connection: getRedis()`.
 */
import { disconnect } from '@borradh-workspace/redis';

afterAll(async () => {
  try {
    await disconnect();
  } catch {
    // best-effort: the file may never have touched Redis, or the client may
    // already be closing — either way teardown must not fail here.
  }
});
