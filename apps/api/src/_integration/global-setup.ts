import { writeFileSync } from 'node:fs';
/**
 * Jest globalSetup for integration tests.
 *
 * Starts ephemeral PostgreSQL + Redis containers (testcontainers), points
 * process.env.DATABASE_URL / REDIS_URL at them, and applies the committed
 * drizzle migrations. The container handles are stashed on globalThis so
 * global-teardown.ts can stop them.
 *
 * Why a real Redis (not a mock): booting a controller transitively constructs
 * BullMQ queues, which open an ioredis connection. With no Redis reachable,
 * ioredis retries forever (packages/redis's retryStrategy never returns null),
 * spamming the log and keeping the process alive past the CI job timeout.
 * Integration tests use REAL dependencies — so we give them a real Redis,
 * mirroring the Postgres container, rather than stubbing it out.
 *
 * CRITICAL ORDERING: process.env.DATABASE_URL/REDIS_URL must be set here,
 * BEFORE any test file imports the `db` / redis singletons. Those clients are
 * lazily initialised, so setting the env vars in globalSetup is sufficient —
 * but workers are separate processes, so the URLs are also persisted to files
 * the per-worker setup file (setup-after-env.ts) reads.
 *
 * NOTE: this file is loaded by jest's own CommonJS loader and compiled to CJS
 * (see jest.integration.config.ts). It deliberately avoids `import.meta` and
 * top-level ESM-only constructs; deps are pulled in via `require`/CJS interop.
 */
import path from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { GenericContainer, Wait } from 'testcontainers';

// __dirname is available because this file is compiled to CommonJS.
const MIGRATIONS_FOLDER = path.resolve(
  __dirname,
  '../../../../packages/database/drizzle'
);
const URL_FILE = path.resolve(__dirname, '.int-db-url');
const REDIS_URL_FILE = path.resolve(__dirname, '.int-redis-url');

export default async function globalSetup(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('[int-setup] Starting PostgreSQL + Redis testcontainers…');

  // Start both containers in parallel. pgvector image: the baseline migration
  // declares vector(1536) columns and hnsw indexes, so the DB must ship
  // pgvector. redis:7 matches the dev/prod Redis major.
  const [container, redisContainer] = await Promise.all([
    new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('borradh_test')
      .withUsername('test')
      .withPassword('test')
      .start(),
    new GenericContainer('redis:7')
      .withExposedPorts(6379)
      // Wait for redis to actually accept connections, not just for the port to
      // be mapped — otherwise BullMQ's first connect races container startup and
      // logs a burst of (recovered) ECONNREFUSED.
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start(),
  ]);

  const url = container.getConnectionUri();
  // Use the IPv4 loopback explicitly: getHost() returns 'localhost', which node
  // resolves to ::1 first. The container binds IPv4-only, so the ::1 attempt is
  // refused (then recovered via 127.0.0.1) — that fallback logs a burst of
  // harmless ECONNREFUSED. Pinning 127.0.0.1 skips the ::1 attempt entirely.
  const redisHost = redisContainer.getHost();
  const redisUrl = `redis://${redisHost === 'localhost' ? '127.0.0.1' : redisHost}:${redisContainer.getMappedPort(6379)}`;

  process.env.DATABASE_URL = url;
  process.env.REDIS_URL = redisUrl;
  const g = globalThis as unknown as {
    __PG_CONTAINER__?: unknown;
    __REDIS_CONTAINER__?: unknown;
  };
  g.__PG_CONTAINER__ = container;
  g.__REDIS_CONTAINER__ = redisContainer;

  // eslint-disable-next-line no-console
  console.log(
    `[int-setup] Containers up. Running migrations from ${MIGRATIONS_FOLDER}…`
  );

  const migrationClient = postgres(url, { max: 1 });
  const migrationDb = drizzle(migrationClient);
  try {
    // The committed migrations do NOT `CREATE EXTENSION`, so create the needed
    // extensions before migrating.
    await migrationClient.unsafe('CREATE EXTENSION IF NOT EXISTS vector');
    await migrationClient.unsafe('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await migrate(migrationDb, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await migrationClient.end();
  }

  // Jest spawns each test file in its own worker process; globalSetup runs in
  // the main process. process.env mutations here do NOT propagate to workers,
  // so persist the URLs to files the per-worker setup file reads.
  writeFileSync(URL_FILE, url, 'utf-8');
  writeFileSync(REDIS_URL_FILE, redisUrl, 'utf-8');

  // eslint-disable-next-line no-console
  console.log('[int-setup] Migrations applied. Ready.');
}
