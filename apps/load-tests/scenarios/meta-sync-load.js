import { check, sleep } from 'k6';
import http from 'k6/http';
import { Rate, Trend } from 'k6/metrics';
import { authPost, ensureAuthenticated } from '../helpers/auth.js';

/**
 * Meta-sync under load scenario.
 *
 * Drives concurrent hits to the Meta-sync trigger endpoint and asserts it stays
 * RESPONSIVE and never 5xx under contention. Targets the withDbRetry-gap path:
 * per memory/reference_pg_null_write_transient.md, "post-Meta DB writes in
 * sync-all weren't withDbRetry-wrapped → prod 500s" when Fly's NAT severed an
 * idle pooled connection during the slow external Meta call. This is the exact
 * class of failure (PR #483) that a sustained, concurrent sync load can surface.
 *
 * ─── CONFIRMED REAL ENDPOINT ─────────────────────────────────────────────────
 *   POST /meta-campaigns/sync-all
 *     apps/api/src/meta-campaigns/meta-campaigns.controller.ts:400
 *       (@Post('sync-all'), @Controller('meta-campaigns') line 46,
 *        @UseGuards(AuthGuard, RoleGuard) line 47).
 *     `sync-all` itself carries NO @RequireRole, so AuthGuard + an active org is
 *     all that's needed (the controller calls requireActiveOrganization(orgId)
 *     → 400 BAD_REQUEST if the session has no active org, :405-406).
 *   Handler calls syncMetaData(db, { organizationId, userId, force: false })
 *     (meta-campaigns.controller.ts:408-412) →
 *     packages/features/src/meta-sync/services/sync-meta-data/sync-meta-data.service.ts.
 *   There is NO global API prefix (apps/api/src/main.ts has no setGlobalPrefix),
 *   so `/meta-campaigns/sync-all` is the real path.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─── BEHAVIOUR NOTE: the 5-min throttle (real, expected) ─────────────────────
 * syncMetaData has a 5-MINUTE throttle cooldown (SYNC_THROTTLE_MS = 5*60*1000,
 * sync-meta-data.service.ts:35) and the controller hardcodes `force: false`
 * (controller.ts:411). So the FIRST sync per org actually hits Meta + writes to
 * the DB; every subsequent call inside the window returns 200 with
 * `{ skipped: true, lastSyncAt }` (controller.ts:418-419) WITHOUT touching Meta
 * or the DB. That is the correct, responsive behaviour we assert here: under a
 * burst, the endpoint must stay a fast 200 (skipped or fresh) and must never
 * 5xx. We therefore CANNOT force the unwrapped-write path to run on every
 * iteration from one org via this public route — the throttle absorbs the
 * burst. To exercise the actual withDbRetry-gap write repeatedly you need
 * EITHER many distinct orgs (one un-throttled first-sync each) OR a force-sync
 * test hook; see the load-test target doc.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─── OBSERVE-ONLY ON THE CURRENT LOAD-TEST ORG (verified 2026-06-16) ──────────
 * The seeded load-test org has NO Meta integration connected, so with an active
 * org set, sync-all returns a clean 412 ("Meta Ads integration not configured")
 * and short-circuits BEFORE the sync/DB-write path even runs. So on this target
 * the scenario is BEHAVIOURAL-ONLY: it proves sync-all stays up, authn/active-org
 * checks pass, and the precondition sheds fast + never 5xx under load — it does
 * NOT exercise the unwrapped-write regression. To exercise that write path, seed
 * a Meta Ads integration on the org (POST /testing/seed-meta-ads, requires
 * re-opening the /testing endpoints) so sync-all gets past the 412 precondition.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─── UNVERIFIABLE WITHOUT A LIVE TARGET ──────────────────────────────────────
 * A real wedge of the unwrapped write needs (a) a prod-shaped pool (small remote
 * `max` per client.ts) so a severed idle connection actually starves the pool,
 * (b) Fly's NAT in the path (it's the NAT idle-kill that severs the connection),
 * and (c) the throttle bypassed (distinct orgs or a force hook) so the DB-write
 * path runs under load instead of short-circuiting on `skipped`. None of that is
 * reproducible here (no target, single throttled org). The thresholds in
 * helpers/config.js (`metaSyncLoad`) and the arrival rate in scripts/backlog.js
 * are PLACEHOLDERS sized for a prod-representative target; re-tune against
 * `borradh-api-loadtest`. Behaviour is UNVERIFIED here.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Custom metrics. `sync_server_errors` is gated in helpers/config.js
// (metaSyncLoad) — ANY 5xx from sync-all under load is the failure we hunt (the
// unwrapped post-Meta DB write 500ing on a severed connection). `sync_skipped`
// is informational: a high skipped-rate just confirms the 5-min throttle is
// absorbing the burst (expected from a single org).
const syncServerErrors = new Rate('sync_server_errors');
const syncSkippedRate = new Rate('sync_skipped_rate');
// 412 PRECONDITION_FAILED — the org has no Meta integration connected, so
// sync-all sheds cleanly BEFORE the sync/DB-write logic. Informational: a high
// rate here just means "this org isn't Meta-connected" (the default on the
// load-test org), which is why this run is behavioural-only — see the header note.
const syncPreconditionRate = new Rate('sync_precondition_rejected_rate');
const syncDuration = new Trend('meta_sync_duration', true);

export function metaSyncLoad() {
  // sync-all is org-scoped behind AuthGuard; authenticate once per VU.
  const jar = ensureAuthenticated();
  if (!jar) {
    // No session → can't exercise the route at all. Record as an error so a
    // mis-provisioned run is loud, not silently green.
    syncServerErrors.add(true);
    return;
  }

  // Empty body — the handler takes nothing from the request body (org + user
  // come from the session, `force` is hardcoded false in the controller).
  //
  // Declare the clean, EXPECTED non-2xx statuses so a healthy shed doesn't
  // inflate k6's http_req_failed (it counts any >=400 as failed): 412 when the
  // org has no Meta integration (the default load-test org → the common case
  // here), 400 NO_ACTIVE_ORG, 403 role reject. A 5xx is NEVER expected and still
  // counts (and trips sync_server_errors) — that's the regression we hunt.
  const res = authPost(
    '/meta-campaigns/sync-all',
    {},
    {
      responseCallback: http.expectedStatuses(200, 400, 403, 412),
      tags: { name: 'POST /meta-campaigns/sync-all' },
    }
  );

  syncDuration.add(res.timings.duration);
  syncServerErrors.add(res.status >= 500);
  syncPreconditionRate.add(res.status === 412);

  // 200 body distinguishes a throttled skip from a fresh sync — both are
  // healthy. Anything that isn't parseable JSON on a 200 is suspicious but not
  // counted as a skip.
  let skipped = false;
  if (res.status === 200) {
    try {
      skipped = JSON.parse(res.body)?.skipped === true;
    } catch {
      skipped = false;
    }
  }
  syncSkippedRate.add(skipped);

  check(res, {
    // The core invariant: sync-all stays responsive and NEVER 5xx under load.
    // A 5xx here is the unwrapped-write regression (severed-conn → 500).
    'meta-sync: not 5xx (write path survives load)': (r) => r.status < 500,
    // Healthy responses: a fresh sync or a throttled skip (both 200), or a clean
    // 412 (no Meta integration — the default on the load-test org), 400
    // NO_ACTIVE_ORG, or 403 role reject (provisioning/precondition, not server
    // faults). Never a 5xx.
    'meta-sync: 200 or clean 4xx/412 (no server fault)': (r) =>
      r.status === 200 || (r.status >= 400 && r.status < 500),
  });

  // Small pace so a single VU doesn't spin a tight loop; the arrival-rate
  // executor (scripts/backlog.js) controls the actual offered concurrency.
  sleep(0.5);
}
