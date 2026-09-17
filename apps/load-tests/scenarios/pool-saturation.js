import { check, sleep } from 'k6';
import http from 'k6/http';
import { Rate, Trend } from 'k6/metrics';
import { authGet, ensureAuthenticated } from '../helpers/auth.js';
import { API_URL } from '../helpers/config.js';

/**
 * Pool-saturation / connection-wedge scenario.
 *
 * Targets the #1 production failure cluster: the Fly↔Neon connection-pool wedge
 * (Sentry API-58 4,578 ev, API-63 1,975 ev; Linear ENG-348/347). When the
 * pooled DB connections wedge (Fly NAT severs idle connections, orphaned
 * `idle in transaction` rows starve PgBouncer), DB-backed endpoints start
 * returning 503/5xx and `/health/ready` flips `database: down` — while Neon
 * itself is healthy.
 *
 * The shape that reproduces it (per memory/project_db_pool_supervisor.md):
 *   - SUSTAINED concurrency (many in-flight requests at once), and
 *   - against a prod-representative pool (`max=10` remote per client.ts), so the
 *     small pool is the bottleneck under enough concurrency.
 *
 * This scenario drives concurrent DB-backed reads + the deep readiness probe.
 * It is a regression guard that the `client.ts` mitigations still hold:
 *   - idle_in_transaction_session_timeout='10s'
 *   - tcp_user_timeout / TCP resilience tuning
 *   - the RlsInterceptor txn-per-request only runs when RLS_ENABLED
 *
 * ─── WHAT THIS MEASURES — AND WHY IT IS NOT A REAL WEDGE TEST (verified 2026-06-16)
 * You CANNOT reproduce a Fly↔Neon pool wedge by throwing request volume at the
 * public API from one IP. To saturate a ~10-connection pool you need >10
 * concurrent in-flight DB ops (Little's Law: arrival_rate × hold_time > 10, i.e.
 * ~200 served req/s at ~50ms/query). Three walls stop that here, each hit before
 * the pool fills:
 *   1. RATE LIMITER caps arrival. Each DB route inherits the global 600/min
 *      (= 10/s) per-route-per-IP FlyThrottlerGuard limit (NestJS keys the
 *      throttler per route+IP). From one runner IP at most ~10/s reach the DB on
 *      a route; the rest are 429'd before touching a connection. 10/s × 50ms =
 *      0.5 connections busy — nowhere near 10. (That shedding IS the pool's first
 *      line of defence; rate_limit_burst proves it cleanly on GET /.)
 *   2. BOX CPU saturates first. Even bypassing the limiter, the shared-cpu-2x
 *      box pegs its 2 vCPUs on request/ORM overhead long before 10 connections
 *      are simultaneously busy. Measured: 25/s → p95 ~12s + readiness timeouts,
 *      50/s → full timeouts. That is CPU exhaustion, NOT a pool wedge — gating on
 *      it would be fabricating signal.
 *   3. THE REAL WEDGE ISN'T VOLUME. The prod incident (memory:
 *      project_db_pool_supervisor) was structural: the RLS interceptor wrapped
 *      every request in a txn; Fly NAT severs idle TCP conns after ~30 min; a
 *      severed conn holding an open txn becomes an `idle in transaction` orphan
 *      that never returns to PgBouncer; orphans pile up → pool starved → 503
 *      database:down while Neon is healthy. That's a connection-LIFECYCLE bug,
 *      not throughput — heavy load actually PREVENTS it (busy conns never idle).
 *
 * So on this target this is an honest GRACEFUL-DEGRADATION / regression guard,
 * not a wedge reproducer: at the box's sustainable rate (POOL_RATE=10/s) it
 * asserts sustained concurrent DB reads do NOT wedge the pool and /health/ready
 * stays 200 (db up). If a regression reintroduced a per-request held txn (the
 * RLS-interceptor class of bug), even 10/s sustained would wedge → caught here.
 * REAL wedge coverage needs a different harness: RLS_ENABLED + a ~30-min soak so
 * NAT idle-kills a held txn, OR a synthetic test-only endpoint that opens N
 * long-held transactions to exceed `max` directly (filed as a follow-up).
 * Endpoints are confirmed real (leads.controller.ts, health.controller.ts).
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Custom metrics so a wedge is legible in the summary even though k6's default
// http_req_failed already counts 5xx as failures.
const dbErrorRate = new Rate('db_backed_error_rate');
const dbReadDuration = new Trend('db_backed_read_duration', true);
// Informational: the share of org-scoped reads the limiter sheds as 429. EXPECTED
// to be high under this offered rate (we deliberately exceed the 10/s limit);
// it confirms the limiter is protecting the pool, so it is NOT gated.
const dbReadRateLimited = new Rate('db_read_rate_limited');

// DB-backed GET endpoints (all confirmed in apps/api/src):
//   /leads        -> leads.controller.ts:77  (listLeads — org-scoped query)
//   /leads/stats  -> leads.controller.ts:207 (aggregate query)
//   /health/ready -> health.controller.ts:73 (DB + Redis check; SkipThrottle)
const DB_READ_ENDPOINTS = ['/leads', '/leads/stats'];

export function poolSaturation() {
  // Authenticate once per VU (no-op after the first iteration). The org-scoped
  // reads below require a session; the readiness probe does not.
  const jar = ensureAuthenticated();

  // 1. Hammer a DB-backed, org-scoped read. Above 10/s the global limiter sheds
  //    the excess as 429 (protecting the pool); the rest reach the DB. Declare
  //    200 + 429 as the EXPECTED outcomes so a healthy shed doesn't inflate
  //    http_req_failed (which then meaningfully gates on the real failure: 5xx).
  if (jar) {
    const endpoint =
      DB_READ_ENDPOINTS[Math.floor(Math.random() * DB_READ_ENDPOINTS.length)];
    const res = authGet(endpoint, {
      responseCallback: http.expectedStatuses(200, 429),
      tags: { wedge_step: 'db_read' },
    });
    dbReadDuration.add(res.timings.duration);
    // A wedged pool surfaces as 5xx (DB unavailable) — that's the failure we
    // want to catch. 429 = limiter shedding (expected, protective). 4xx (e.g.
    // 401 if the session lapsed) is NOT a pool wedge.
    dbErrorRate.add(res.status >= 500);
    dbReadRateLimited.add(res.status === 429);
    check(res, {
      // The core invariant: a served read (200) or a clean shed (429), never a
      // 5xx. A 5xx means a read reached the DB and the pool fell over.
      'db read: 200 or 429 (pool protected, never 5xx)': (r) =>
        r.status === 200 || r.status === 429,
      'db read: not 5xx (pool healthy)': (r) => r.status < 500,
    });
  }

  // 2. Deep readiness probe — the canary the prod incident keyed on:
  //    /health/ready returns 503 with `database: down` the instant the pool
  //    wedges. Under pressure we expect it to STAY 200 (healthy).
  //
  //    SAMPLE it, don't hammer it. /health/ready is @SkipThrottle (the limiter
  //    won't cap it) and does a real DB + Redis round-trip, so calling it every
  //    iteration turns the canary itself into the dominant load — at a high
  //    arrival rate that CPU-saturates the small shared-cpu-2x box and makes the
  //    probe time out for reasons unrelated to the pool. Polling ~10% of
  //    iterations keeps it a frequent canary (a real wedge persists for seconds
  //    → many samples) without it becoming the bottleneck.
  if (Math.random() < 0.1) {
    const readyRes = http.get(`${API_URL}/health/ready`, {
      timeout: '10s',
      tags: { name: 'GET /health/ready', wedge_step: 'readiness' },
    });
    check(readyRes, {
      'readiness: 200 (db+redis up)': (r) => r.status === 200,
      'readiness: db not reported down': (r) => {
        // 503 body carries the failed checks; a 200 means both up.
        if (r.status === 200) return true;
        try {
          const body = JSON.parse(r.body);
          return body?.checks?.database?.status !== 'down';
        } catch {
          return false;
        }
      },
    });
  }

  // Short pause — deliberately small to keep concurrency high. The executor
  // (constant-arrival-rate in scripts/wedge.js) controls actual pressure; this
  // sleep just prevents a single VU from spinning a tight CPU loop.
  sleep(0.2);
}
