import { withDbRetry } from '@borradh-workspace/database';
import { sql } from 'drizzle-orm';
import { type DbConnection, type Result, ok } from '../../../shared/index.js';

/**
 * Database health check response
 */
export interface DatabaseHealthResponse {
  status: 'up' | 'down';
  latencyMs: number;
  error?: string;
}

/**
 * Check database health with latency measurement.
 * Note: Health checks are NOT tracked in PostHog/Sentry to avoid noise.
 *
 * @param db - Database connection
 * @returns Result with health status
 *
 * @example
 * ```ts
 * const result = await checkDatabaseHealth(db);
 *
 * if (result.success && result.data.status === 'up') {
 *   console.log('Database is healthy');
 * }
 * ```
 */
export const checkDatabaseHealth = async (
  db: DbConnection
): Promise<Result<DatabaseHealthResponse>> => {
  const start = Date.now();

  try {
    // Simple query to verify connection. Retry transient connection drops on a
    // fresh connection so a single stale pooled connection doesn't flap
    // /health/ready to "down". Tight params to stay within the readiness
    // probe's 8s budget (a stale connection errors fast; the retry reconnects).
    // One retry only — enough to rule out a single dead pooled socket
    // (postgres.js can hand out a stale connection; it fails in ms and a fresh
    // one succeeds), but NOT enough to mask a real outage. In this system a
    // failing probe has always been a true outage, so we want `down` reported
    // fast: worst case 2 attempts (~2s each) + one short backoff ≈ 4s, well
    // under the readiness 8s budget. attemptTimeoutMs converts a *hang*
    // (PgBouncer holding the socket while a suspended compute wakes) into a
    // fast, retryable error instead of letting it eat the whole budget.
    await withDbRetry(() => db.execute(sql`SELECT 1`), {
      retries: 1,
      minDelayMs: 100,
      maxDelayMs: 300,
      attemptTimeoutMs: 2000,
    });

    return ok({
      status: 'up',
      latencyMs: Date.now() - start,
    });
  } catch (error) {
    return ok({
      status: 'down',
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Result type for checkDatabaseHealth
 */
export type CheckDatabaseHealthResult = Awaited<
  ReturnType<typeof checkDatabaseHealth>
>;
