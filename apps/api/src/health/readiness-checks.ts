import { db } from '@borradh-workspace/database';
import { checkDatabaseHealth } from '@borradh-workspace/features/health';
import { getAppVersion, logError } from '@borradh-workspace/observability';
import { getRedis } from '@borradh-workspace/redis';

/**
 * The dependency probes behind `GET /health/ready`.
 *
 * These were three private methods on `HealthController` (`withTimeout`,
 * `checkDatabase`, `checkRedis`) plus a 60-line handler. None of it is an HTTP
 * concern — pinging Postgres and Redis is the same work whether the caller is a
 * route, a CLI or the metrics collector — so it lives here and the handler is
 * left with "call it, 503 if unhealthy, return it".
 *
 * RESPONSE SHAPE IS A CONTRACT. Uptime monitors assert on `status`,
 * `checks.database.latencyMs` and `checks.redis.latencyMs`, so the object built
 * here is byte-for-byte what the controller used to build, including the
 * deliberate omission of `latencyMs` when a probe times out.
 */

export interface HealthCheckDetail {
  status: 'up' | 'down';
  latencyMs?: number;
}

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    database: HealthCheckDetail;
    redis: HealthCheckDetail;
  };
}

/**
 * Cap a probe so a stale TCP connection (e.g. a NAT gateway silently dropping
 * an idle socket) cannot hang the readiness endpoint. A timed-out probe reports
 * `down` with NO `latencyMs` — that absence is how a hang is distinguished from
 * a fast refusal in the monitor's history, so do not "helpfully" add one.
 */
function withTimeout(
  promise: Promise<HealthCheckDetail>,
  ms: number
): Promise<HealthCheckDetail> {
  return Promise.race([
    promise,
    new Promise<HealthCheckDetail>((resolve) =>
      setTimeout(
        () =>
          resolve({
            status: 'down',
          }),
        ms
      )
    ),
  ]);
}

/**
 * Check database connectivity with latency measurement.
 *
 * `checkDatabaseHealth` wraps the probe in `withDbRetry` with a short
 * per-attempt timeout, so a single stale pooled connection retries on a fresh
 * one and a genuine outage still reports `down` in a few seconds. The client
 * socket timeout in the db client (see `client.ts`) guarantees a black-holed
 * connection errors out rather than hanging forever, so the abandoned probe
 * query frees its connection instead of leaking it.
 */
export async function checkDatabase(): Promise<HealthCheckDetail> {
  const result = await checkDatabaseHealth(db);
  if (result.success) {
    return result.data;
  }
  return { status: 'down' };
}

/**
 * Check Redis connectivity with latency measurement.
 *
 * ioredis is configured with enableOfflineQueue=true and maxRetriesPerRequest=null
 * (required for BullMQ). This means ping() will queue forever on a disconnected
 * client instead of rejecting. We check connection status first to fail fast.
 */
export async function checkRedis(): Promise<HealthCheckDetail> {
  const start = Date.now();
  try {
    const client = getRedis();
    const status = client.status;

    // If not in 'ready' state, the client is disconnected/reconnecting
    // Don't call ping() as it will queue indefinitely with enableOfflineQueue
    if (status !== 'ready') {
      return {
        status: 'down',
        latencyMs: Date.now() - start,
      };
    }

    await client.ping();
    return {
      status: 'up',
      latencyMs: Date.now() - start,
    };
  } catch {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
    };
  }
}

const READY_TIMEOUT_MS = 8000;

/**
 * Run every readiness probe and assemble the `/health/ready` body.
 *
 * Also emits the ERROR-level log on failure — that log is part of the probe,
 * not part of the response: it is the signal the Sentry/BetterStack alert rule
 * keys on, and it must fire on the FIRST failed probe, before the caller turns
 * the result into a 503. `SanitizeErrorsFilter` masks the 503 body, so this is
 * the only place the failure detail is visible.
 *
 * The caller is responsible for the status code: `unhealthy` → 503.
 */
export async function runReadinessChecks(
  startTime: number
): Promise<HealthCheckResult> {
  const timestamp = new Date().toISOString();
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  const version = getAppVersion();

  // Check all dependencies in parallel with a timeout to prevent hanging
  // on stale TCP connections (e.g., NAT gateway dropping idle connections)
  const [dbCheck, redisCheck] = await Promise.all([
    withTimeout(checkDatabase(), READY_TIMEOUT_MS),
    withTimeout(checkRedis(), READY_TIMEOUT_MS),
  ]);

  // No grace / no masking: in this system a failing dependency check has
  // always meant a real outage, never a recoverable blip. Report `down`
  // immediately and 503 so the failure surfaces to alerting the instant it
  // happens. The fast-fail comes from checkDatabaseHealth's per-attempt
  // timeout — the probe returns `down` in ~seconds instead of hanging.
  const allChecksPass = dbCheck.status === 'up' && redisCheck.status === 'up';
  const anyCheckFailed =
    dbCheck.status === 'down' || redisCheck.status === 'down';
  const status = allChecksPass
    ? 'healthy'
    : anyCheckFailed
      ? 'unhealthy'
      : 'degraded';

  const result: HealthCheckResult = {
    status,
    timestamp,
    version,
    uptime,
    checks: {
      database: dbCheck,
      redis: redisCheck,
    },
  };

  if (anyCheckFailed) {
    const failed = Object.entries(result.checks)
      .filter(([, v]) => v.status === 'down')
      .map(([k]) => k);
    // ERROR-level so the Sentry/BetterStack alert fires on the FIRST failed
    // probe — this is the immediate "DB unavailable" signal. The tag lets an
    // alert rule key on it directly. Not visible in the 503 body, which
    // SanitizeErrorsFilter masks.
    logError(
      'health.readiness',
      new Error(`Health check failed: ${failed.join(', ')}`),
      {
        feature: 'health',
        tags: { healthCheckFailed: failed.join(',') },
        extra: { checks: result.checks, uptime },
      }
    );
  }

  return result;
}
