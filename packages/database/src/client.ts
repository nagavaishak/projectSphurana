import { databaseEnv } from '@borradh-workspace/env/database';
import { sql } from 'drizzle-orm';
import { type PostgresJsDatabase, drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Options } from 'postgres';
import * as schema from './schema/index.js';

// Lazy-initialized database clients, keyed by connection URL so each distinct
// role URL gets exactly one pool per process. The default (owner) client and
// the RLS role clients (app_authenticated / app_public / app_system) all flow
// through here, so they share identical pool tuning + the idle-in-transaction
// guard below.
const _clients = new Map<string, PostgresJsDatabase<typeof schema>>();
let _db: PostgresJsDatabase<typeof schema> | null = null;

/**
 * Detect database provider from URL.
 * 'remote' covers any managed Postgres requiring TLS (RDS, Neon, etc.).
 */
function getDbProvider(url: string): 'remote' | 'local' {
  if (url.includes('rds.amazonaws.com')) return 'remote';
  if (url.includes('neon.tech')) return 'remote';
  return 'local';
}

function getSslConfig(
  provider: 'remote' | 'local'
): Options<Record<string, never>>['ssl'] {
  return provider === 'remote' ? 'require' : false;
}

/**
 * Get the database client instance.
 * The client is lazily initialized on first access to ensure
 * environment variables are loaded before connection.
 *
 * Supports:
 * - Local PostgreSQL (dev): No SSL
 * - AWS RDS (prod): SSL required
 */
/**
 * Build (and cache, per distinct URL) a drizzle client for a connection string.
 * The default owner connection and the RLS role connections all go through here
 * so they share the exact same pool tuning.
 */
function getClientForUrl(
  databaseUrl: string
): PostgresJsDatabase<typeof schema> {
  const cached = _clients.get(databaseUrl);
  if (cached) return cached;
  {
    const provider = getDbProvider(databaseUrl);
    const ssl = getSslConfig(provider);

    const isLocal = provider === 'local';

    // Neon's pooled endpoint (`<ep>-pooler.<region>.aws.neon.tech`) fronts the
    // database with PgBouncer in *transaction* pooling mode. That keeps a stable
    // server-side pool so a client's connections don't wedge when the Neon
    // compute suspends/resumes or under burst load (the Fly→Neon "database:down,
    // redis:up" symptom). But transaction pooling can't carry session-level
    // prepared statements across pooled backends — postgres.js uses named
    // prepared statements by default, so they MUST be disabled on a pooler or
    // queries intermittently fail with "prepared statement \"…\" does not exist".
    // Detected from the URL so direct connections (local, migrations, prod
    // pre-pooler) keep prepared statements.
    const isPooled = databaseUrl.includes('-pooler.');
    const options: Options<Record<string, never>> = {
      ssl,
      prepare: !isPooled,
      // Keep the per-process pool small on any managed endpoint. Each Fly
      // process runs its OWN pool, so the real connection count is
      // `max × processes`. Behind the Neon pooler (PgBouncer, transaction mode)
      // a small client pool is all you need — PgBouncer multiplexes onto the
      // server — and fewer connections means fewer candidates for Fly's NAT to
      // silently sever. 10 gives each process ample concurrency while keeping
      // the fleet-wide total well clear of the compute's connection ceiling.
      max: isLocal ? 30 : 10,
      // Recycle idle connections before they sit long enough for Fly's NAT to
      // silently sever them.
      idle_timeout: isLocal ? 20 : 30,
      max_lifetime: isLocal ? 60 * 30 : 600, // was 1800 — DON'T match Fly's 30min killer
      connect_timeout: 10,
      keep_alive: 10,
      connection: {
        // Server-side cap on query duration. (Previously this block also set
        // `tcp_user_timeout`, but in `connection: {}` that is sent as a *server*
        // GUC — it bounds Neon's socket back to us, the wrong direction — so it
        // was removed. A client-side dead-socket timeout via a custom `socket`
        // factory was tried (commit 48863edd) but silently stalled connections
        // on Fly because postgres.js writes the SSL request before the socket's
        // `connect` event when a factory is supplied; reverted. See
        // packages/database notes before reattempting — it must await `connect`.)
        statement_timeout: 30_000,
      },
    };

    const client = postgres(databaseUrl, options);
    const instance = drizzle(client, { schema });
    _clients.set(databaseUrl, instance);
    return instance;
  }
}

/**
 * Get the default (owner / DATABASE_URL) database client. Lazily initialized so
 * env vars are loaded before connection.
 */
export function getDb(): PostgresJsDatabase<typeof schema> {
  if (!_db) {
    const databaseUrl = databaseEnv.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        'DATABASE_URL environment variable is not set. ' +
          'Make sure your .env file is loaded before importing the database module.'
      );
    }
    _db = getClientForUrl(databaseUrl);
  }
  return _db;
}

/**
 * Cap on how long any transaction may sit *idle between statements*.
 *
 * A Fly-NAT-severed connection can orphan a transaction mid-flight (BEGIN +
 * first statements done, COMMIT never sent because the client socket died),
 * leaving the server backend `idle in transaction` forever. On the Neon pooled
 * endpoint (PgBouncer transaction mode) those orphans hold PgBouncer's server
 * pool, so every *new* client connection is starved — the recurring "DB
 * connections saturated / database:down while Neon is healthy" wedge. Postgres
 * does NOT time these out by default. This does.
 *
 * Counts only idle time *between* statements, so legitimate transactions (which
 * run statements back-to-back) are never affected — only abandoned ones.
 *
 * 10s (not 30s): with a max-10 pool, a synchronized batch of orphans fills every
 * slot, so the pool stays saturated for the whole window before they're reaped.
 * 10s clears them ~3× faster so the pool recovers between batches. The only
 * thing a 10s cap kills that 30s wouldn't is a transaction deliberately held
 * idle >10s mid-flight — which is an anti-pattern (don't await slow/external
 * work inside a DB transaction).
 */
const TRANSACTION_IDLE_TIMEOUT = '10s';

// Lazily access the real db, and wrap `transaction` so every transaction caps
// its own idle-in-transaction time. Done at this single choke point so it
// covers ALL `db.transaction()` callers — the RLS wrappers and every direct
// caller, present and future — with no per-site changes. `SET LOCAL` is used
// because (unlike a session-level GUC or a connection startup param) it
// propagates through PgBouncer transaction-mode pooling (verified against the
// Neon pooler).
/**
 * Wrap a (lazily-resolved) drizzle instance in a Proxy that injects the
 * idle-in-transaction timeout into every `transaction()`. Used for the default
 * client AND each RLS role client so the saturation guard covers all pools.
 */
function makeIdleGuardedProxy(
  resolve: () => PostgresJsDatabase<typeof schema>
): PostgresJsDatabase<typeof schema> {
  return new Proxy({} as PostgresJsDatabase<typeof schema>, {
    get(_target, prop) {
      const instance = resolve();
      if (prop === 'transaction') {
        const runTransaction = instance.transaction.bind(instance);
        return (
          txFn: (tx: unknown) => Promise<unknown>,
          config?: unknown
        ): Promise<unknown> =>
          runTransaction(async (tx) => {
            // SET cannot take bind parameters; the value is a trusted constant.
            await tx.execute(
              sql.raw(
                `SET LOCAL idle_in_transaction_session_timeout = '${TRANSACTION_IDLE_TIMEOUT}'`
              )
            );
            return txFn(tx);
          }, config as never);
      }
      return (instance as unknown as Record<string | symbol, unknown>)[prop];
    },
  });
}

export const db = makeIdleGuardedProxy(getDb);

/**
 * Resolve a role-specific client. When the role URL is unset (most
 * environments until RLS is provisioned), this falls back to the default
 * owner client, so the role-scoped pools are a no-op until wired — exactly like
 * the RLS flag itself. When set (Phase 2 / I3 per-env), the API connects authed
 * routes as app_authenticated, the open booking flow as app_public, and
 * workers/webhooks as app_system (BYPASSRLS).
 */
function resolveRoleClient(
  roleUrl: string | undefined
): PostgresJsDatabase<typeof schema> {
  return roleUrl ? getClientForUrl(roleUrl) : getDb();
}

/** app_authenticated pool — authenticated API request path. */
export const dbAuthenticated = makeIdleGuardedProxy(() =>
  resolveRoleClient(databaseEnv.DATABASE_URL_AUTHENTICATED)
);

/** app_public pool — the open, unauthenticated booking flow (least-privilege). */
export const dbPublic = makeIdleGuardedProxy(() =>
  resolveRoleClient(databaseEnv.DATABASE_URL_PUBLIC)
);

/** app_system pool — workers / webhook-router / cron (BYPASSRLS). */
export const dbSystem = makeIdleGuardedProxy(() =>
  resolveRoleClient(databaseEnv.DATABASE_URL_SYSTEM)
);

/** app_patient pool — signed-in patient-portal sessions (ENG-647,
 * least-privilege SELECT via `patient_self` policies). */
export const dbPatient = makeIdleGuardedProxy(() =>
  resolveRoleClient(databaseEnv.DATABASE_URL_PATIENT)
);

/**
 * Test the database connection
 * @returns true if connection is successful
 * @throws Error if connection fails
 */
export async function testConnection(): Promise<boolean> {
  await db.execute(sql`SELECT 1`);
  return true;
}

// Export types for use in other packages
export type Database = typeof db;
