/**
 * Load test configuration
 *
 * Environment variables:
 *   K6_API_URL      - Base URL for the API (required)
 *   K6_TEST_EMAIL   - Test user email (optional, defaults to load test user)
 *   K6_TEST_PASSWORD - Test user password (optional)
 */

export const API_URL = (() => {
  if (!__ENV.K6_API_URL)
    throw new Error('K6_API_URL environment variable is required');
  return __ENV.K6_API_URL;
})();
export const TEST_EMAIL = (() => {
  if (!__ENV.K6_TEST_EMAIL)
    throw new Error('K6_TEST_EMAIL environment variable is required');
  return __ENV.K6_TEST_EMAIL;
})();
export const TEST_PASSWORD = (() => {
  if (!__ENV.K6_TEST_PASSWORD)
    throw new Error('K6_TEST_PASSWORD environment variable is required');
  return __ENV.K6_TEST_PASSWORD;
})();

// Thresholds by test type
export const THRESHOLDS = {
  smoke: {
    http_req_duration: ['p(95)<500'], // 95th percentile < 500ms
    http_req_failed: ['rate<0.01'], // < 1% error rate
  },
  load: {
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    http_req_failed: ['rate<0.05'], // < 5% errors
  },
  stress: {
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    http_req_failed: ['rate<0.10'], // < 10% errors (stress test)
  },
  soak: {
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    http_req_failed: ['rate<0.05'],
  },

  // ---------------------------------------------------------------------------
  // Wedge / resilience scenarios (scripts/wedge.js).
  //
  // These map to the production failure modes in
  // docs/testing/release-safety-strategy.md (Pillar 3). The thresholds below
  // are STARTING POINTS chosen to match the existing absolute thresholds'
  // spirit; they MUST be re-tuned once a representative `borradh-api-loadtest`
  // target exists, because absolute numbers are meaningless against an
  // arbitrary preview/empty DB. Until then, treat a breach as "investigate",
  // not "ship-blocking truth".
  //
  // Each group is per-scenario so a single wedge run can carry tagged
  // thresholds (k6 supports per-scenario thresholds via tag selectors —
  // see scripts/wedge.js). Where a metric is tagged by scenario, the key is
  // `metric{scenario:NAME}`.
  // ---------------------------------------------------------------------------

  // Pool saturation / connection-wedge guard — sustained concurrent DB-backed
  // reads at the box's sustainable rate (POOL_RATE=10/s). This is a
  // graceful-degradation / regression guard, NOT a wedge reproducer (a single IP
  // cannot wedge a healthy pool here — see the three walls in
  // scenarios/pool-saturation.js). A wedge surfaces as 5xx on DB reads +
  // /health/ready flipping 503 database:down. Gates:
  //   - http_req_failed: the scenario marks 200 + 429 EXPECTED (http.expectedStatuses),
  //     so this counts only real faults — a 5xx DB read or a 503/timeout from the
  //     readiness canary (i.e. a wedge). rate<0.02 means "essentially no faults".
  //   - http_req_duration: at 10/s this box is genuinely fast (measured p95
  //     ~0.3s, max ~1s over 90s), so this is a MEANINGFUL latency gate now, not a
  //     box-capacity excuse: a sustained climb past 1.5s at this modest rate is a
  //     real regression signal (a wedging pool, a slow query, lock contention).
  //     Re-tune upward only against a prod-representative target.
  poolSaturation: {
    'http_req_duration{scenario:pool_saturation}': ['p(95)<1500', 'p(99)<4000'],
    'http_req_failed{scenario:pool_saturation}': ['rate<0.02'],
  },

  // Assistant-chat SSE stream soak — concurrent long-lived (up to 180s)
  // text/event-stream responses on POST /assistant/chat. The risk is
  // long-lived-connection exhaustion (sockets, the Anthropic client, the DB
  // connection a turn holds). We measure the FULL request duration (stream
  // open → close), so the bound is large by design; the failure signal is the
  // ERROR RATE and dropped/duplicated streams, not the per-request latency.
  // TUNE: bound depends on model latency + tool-loop depth on the real target;
  // and the load-test org must have assistant access + quota headroom or every
  // request 429s (DAILY_LIMIT / MONTHLY_LIMIT) — see scenarios/assistant-stream.js.
  assistantStream: {
    'http_req_failed{scenario:assistant_stream}': ['rate<0.10'],
    'http_req_duration{scenario:assistant_stream}': ['p(95)<185000'],
  },

  // Rate-limit burst — deliberately exceed the global 600/min-per-IP throttler
  // (FlyThrottlerGuard, app.module.ts) and assert the API sheds load CLEANLY:
  // 429s (not 5xx) and fast rejections. NOTE: in production the limit is 600/min;
  // locally / in dev it is 10_000/min (effectively off) and the Redis storage
  // no-ops when E2E_SEED_TOKEN is set — so this scenario only does anything
  // useful against a target running with NODE_ENV=production and no seed-token
  // bypass. We invert the usual gate: a HIGH share of 429s is EXPECTED, so we
  // gate on the absence of 5xx via a custom check/metric in the scenario rather
  // than on http_req_failed (k6 counts 429 as a failed request by default).
  rateLimitBurst: {
    // server_errors is a custom Rate metric defined in the scenario; any 5xx
    // under burst is a real failure (the limiter should 429, not crash).
    'server_errors{scenario:rate_limit_burst}': ['rate<0.01'],
  },

  // Meta-sync under load (scripts/backlog.js) — concurrent hits to
  // POST /meta-campaigns/sync-all. The point is the withDbRetry-gap path: the
  // unwrapped post-Meta DB write that 500'd in prod when Fly's NAT severed an
  // idle pooled connection mid-sync (memory: reference_pg_null_write_transient,
  // PR #483). We gate on the ABSENCE of 5xx (sync-all must stay responsive and
  // never crash under load), via the scenario's custom `sync_server_errors`
  // metric — NOT on http_req_failed, because http_req_failed counts nothing
  // unexpected here (200 + 200-skipped are both fine). p95 is a soft bound:
  // sync-all does real Meta I/O on the first (un-throttled) call, so it's slow
  // by nature; the wide band is intentional and only flags a runaway.
  // TUNE: the unwrapped-write path only reproduces against a prod-shaped pool
  // with Fly NAT in the path AND the 5-min throttle bypassed (distinct orgs or
  // a force hook) — see scenarios/meta-sync-load.js. PLACEHOLDER numbers.
  metaSyncLoad: {
    'sync_server_errors{scenario:meta_sync_load}': ['rate<0.01'],
    'http_req_duration{scenario:meta_sync_load}': ['p(95)<10000'],
  },

  // BullMQ queue-backlog soak (scripts/backlog.js) — enqueue video-render jobs
  // (POST /videos/:id/export) + poll depth (GET /videos/queue/status). The
  // failure signal is BACK-PRESSURE: the enqueue path crashing under flood, the
  // queue read 5xx-ing (Redis/BullMQ down), or the backlog growing unbounded.
  // We gate on custom 5xx Rates from the scenario; `queue_waiting_depth` max is
  // surfaced in the summary but NOT gated here because a healthy plateau depth
  // is entirely a function of worker count on the real target (a generous
  // bound here would be meaningless). The http_req_duration bound covers the
  // CHEAP read+enqueue calls (not the render itself, which runs on the worker).
  // TUNE: a real backlog needs the dedicated target + real Redis + real workers
  // draining `video-render`; without a worker `waiting` only climbs. Pick a
  // `maxWaiting`-style bound once the worker count is known — see
  // scenarios/queue-backlog.js. PLACEHOLDER numbers.
  queueBacklog: {
    'queue_enqueue_errors{scenario:queue_backlog}': ['rate<0.01'],
    'queue_status_errors{scenario:queue_backlog}': ['rate<0.01'],
    'http_req_duration{scenario:queue_backlog}': ['p(95)<3000'],
  },
};
