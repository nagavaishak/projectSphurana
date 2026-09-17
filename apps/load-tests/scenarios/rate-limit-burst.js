import { check } from 'k6';
import http from 'k6/http';
import { Rate } from 'k6/metrics';
import { API_URL } from '../helpers/config.js';

/**
 * Rate-limit burst scenario.
 *
 * Deliberately exceeds the global per-IP request throttler and asserts the API
 * sheds load CLEANLY — returning 429s, never 5xx or hangs. Targets the
 * rate-limit-trip incidents (Linear ENG-251/280) and the strategy's
 * "rate-limit burst → assert clean 429s" item (Pillar 3).
 *
 * ─── CONFIRMED REAL TARGET + LIMIT ───────────────────────────────────────────
 * Global throttler: ThrottlerModule.forRoot in apps/api/src/app/app.module.ts:103
 *   - name 'default', ttl 60_000ms, limit 600/min IN PRODUCTION, 10_000/min in
 *     dev (app.module.ts:106-108).
 *   - Enforced by FlyThrottlerGuard (APP_GUARD, app.module.ts:256), keyed on the
 *     REAL client IP via the `Fly-Client-IP` header
 *     (common/guards/fly-throttler.guard.ts) so all requests from one runner
 *     share a bucket. Redis-backed storage (shared across instances).
 *
 * Target endpoint: GET /  (AppController.getData, apps/api/src/app/app.controller.ts:8).
 *   Chosen because it is UNDECORATED — no per-route @Throttle, no @SkipThrottle,
 *   no AuthGuard — so it inherits exactly the global 600/min default we want to
 *   exceed, with no auth and no side effects. (Health + webhooks are
 *   @SkipThrottle()'d and would never 429; /auth/session has its OWN stricter
 *   120/min @Throttle, so it would trip at 120 not the global 600.)
 *   There is NO global API prefix (main.ts has no setGlobalPrefix), so `/` is the
 *   real root path.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─── UNVERIFIABLE WITHOUT A LIVE TARGET ──────────────────────────────────────
 * This only does anything against a target running NODE_ENV=production (limit
 * 600/min). Against a dev/preview target the limit is 10_000/min and the
 * throttler storage no-ops when E2E_SEED_TOKEN is set (per the app.module.ts
 * comment), so NOTHING will 429 and the scenario will look like a clean pass for
 * the wrong reason. The arrival rate in scripts/wedge.js (well over 600/min) is
 * sized for the production limit; re-tune if the loadtest target uses a
 * different limit. Behaviour is UNVERIFIED here (no target).
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Custom metrics. `server_errors` is gated in helpers/config.js
// (rateLimitBurst) — any 5xx under burst is a real failure: the limiter must
// 429, not crash. `rate_limited` is informational (we EXPECT it to be high).
const serverErrors = new Rate('server_errors');
const rateLimited = new Rate('rate_limited');

export function rateLimitBurst() {
  const res = http.get(`${API_URL}/`, {
    tags: { name: 'GET / (rate-limit burst)' },
  });

  serverErrors.add(res.status >= 500);
  rateLimited.add(res.status === 429);

  check(res, {
    // The core invariant: under burst, every response is EITHER served (200)
    // OR cleanly rejected (429). A 5xx means the limiter let the request
    // through and something downstream fell over.
    'burst: 200 or 429 (clean shedding)': (r) =>
      r.status === 200 || r.status === 429,
    'burst: never 5xx': (r) => r.status < 500,
    // 429s should be FAST rejections (the guard rejects before handler work).
    'burst: rejection is fast (<1s)': (r) =>
      r.status !== 429 || r.timings.duration < 1000,
  });

  // No sleep: the constant-arrival-rate executor (scripts/wedge.js) controls
  // the burst rate. Sleeping here would only reduce achieved RPS.
}
