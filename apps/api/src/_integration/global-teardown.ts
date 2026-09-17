import { rmSync } from 'node:fs';
/**
 * Jest globalTeardown for integration tests — stops the PostgreSQL + Redis
 * containers started in global-setup.ts. Compiled to CJS; avoids import.meta.
 */
import path from 'node:path';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedTestContainer } from 'testcontainers';

const URL_FILE = path.resolve(__dirname, '.int-db-url');
const REDIS_URL_FILE = path.resolve(__dirname, '.int-redis-url');

export default async function globalTeardown(): Promise<void> {
  const g = globalThis as unknown as {
    __PG_CONTAINER__?: StartedPostgreSqlContainer;
    __REDIS_CONTAINER__?: StartedTestContainer;
  };

  await Promise.all([
    g.__PG_CONTAINER__?.stop(),
    g.__REDIS_CONTAINER__?.stop(),
  ]);
  // eslint-disable-next-line no-console
  console.log('[int-teardown] Containers stopped.');

  try {
    rmSync(URL_FILE, { force: true });
    rmSync(REDIS_URL_FILE, { force: true });
  } catch {
    // best-effort cleanup
  }
}
