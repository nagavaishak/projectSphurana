import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { authGet, authPost, ensureAuthenticated } from '../helpers/auth.js';

/**
 * BullMQ queue-backlog soak scenario.
 *
 * Enqueues video-render jobs and observes the queue's depth + completion
 * latency, to surface the back-pressure failure modes the release-safety
 * strategy calls out (Pillar 3): a render/export backlog that grows unbounded,
 * jobs piling into `waiting`, the DLQ filling, or the enqueue endpoint itself
 * falling over under a flood. Redis/BullMQ is the shared spine for renders,
 * Claire async delivery, and idempotency (memory: #489 queue idempotency).
 *
 * ─── CONFIRMED REAL ENDPOINTS ────────────────────────────────────────────────
 *   ENQUEUE  POST /videos/:id/export
 *     apps/api/src/videos/videos.controller.ts:960
 *       (@Post(':id/export'), @Controller('videos') line 88,
 *        @UseGuards(AuthGuard) line 89).
 *     Handler: verifyVideoOwnership(id, org) (controller.ts:174-190 → 404 if the
 *     video doesn't exist, 403 if it isn't the org's) then
 *     queueVideoExport(db, { id }) (controller.ts:968) →
 *     packages/features/src/videos/services/queue-video-export/queue-video-export.service.ts,
 *     which `new Queue('video-render').add(...)` onto BullMQ
 *     (queue-video-export.service.ts:7,26,51-63; RETRY_CONFIG attempts:3).
 *
 *   OBSERVE  GET /videos/queue/status
 *     apps/api/src/videos/videos.controller.ts:263 (@Get('queue/status')) →
 *     getQueueStats() (controller.ts:267) →
 *     packages/features/src/videos/services/get-queue-stats/get-queue-stats.service.ts,
 *     returning { waiting, active, completed, failed, delayed, paused,
 *     avgProcessingTimeMs } straight off the BullMQ queue
 *     (get-queue-stats.service.ts:29-44,53-61). Needs only AuthGuard (no :id, no
 *     ownership check) so every VU can poll it cheaply.
 *
 *   (DLQ depth, if you want to assert it doesn't fill, is GET /videos/admin/dlq/stats,
 *    controller.ts:292 — left out of the hot loop to keep this read cheap.)
 *   No global API prefix (main.ts), so these are the real paths.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─── THE ENQUEUE TARGET MUST BE A REAL, RENDER-READY VIDEO ───────────────────
 * `POST /videos/:id/export` is NOT a synthetic "enqueue N noop jobs" route. It:
 *   - 404s for an unknown id and 403s for another org's id (verifyVideoOwnership),
 *   - rejects an incomplete draft config (isDraftConfigComplete →
 *     queueVideoExport returns a validation error, controller maps to 4xx).
 * So to actually grow a backlog you must point it at ONE real video, owned by
 * the load-test org, whose draftConfig is render-complete. Pass its id via
 * K6_VIDEO_ID. Re-exporting the SAME video repeatedly is the intended shape here
 * (each call re-queues a render job); the goal is queue PRESSURE, not distinct
 * content. Without K6_VIDEO_ID the scenario runs in OBSERVE-ONLY mode (polls
 * /videos/queue/status, never enqueues) so it is still a safe, non-destructive
 * structural pass — but it will NOT build a backlog. This is the closest real
 * enqueue route; there is no test-only "enqueue noop" endpoint to stub against.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─── UNVERIFIABLE WITHOUT A LIVE TARGET ──────────────────────────────────────
 * A MEANINGFUL backlog needs the dedicated target (`borradh-api-loadtest`) wired
 * to a REAL Redis AND real video-worker(s) draining the `video-render` queue —
 * otherwise `waiting` only ever climbs (nothing drains) or the queue is a no-op
 * (no Redis). Real rendering is minutes/job, so a true soak runs long and the
 * worker count sets the drain rate. The thresholds in helpers/config.js
 * (`queueBacklog`) and the enqueue rate in scripts/backlog.js are PLACEHOLDERS;
 * `maxWaiting` especially is target-shaped (depends on worker count) — re-tune
 * once the target + workers exist. Behaviour is UNVERIFIED here (no target, no
 * Redis, no worker).
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Operators point the enqueue loop at a real, render-ready, org-owned video.
// Empty → OBSERVE-ONLY (poll the queue depth, never enqueue).
const VIDEO_ID = __ENV.K6_VIDEO_ID || '';

// Custom metrics.
//   queue_enqueue_errors — gated in config.js (queueBacklog): a 5xx on enqueue
//     is a real failure (the enqueue path fell over under flood). 4xx is NOT
//     counted (a 404/403/validation reject means K6_VIDEO_ID is wrong/incomplete
//     — a config problem, surfaced via the check, not a server fault).
//   queue_waiting / queue_active — observed BullMQ depth, surfaced as Trends so
//     the summary shows the backlog curve (max waiting is the headline number).
//   queue_status_errors — a 5xx reading the queue itself (Redis/BullMQ down).
const enqueueErrors = new Rate('queue_enqueue_errors');
const statusErrors = new Rate('queue_status_errors');
const queueWaiting = new Trend('queue_waiting_depth');
const queueActive = new Trend('queue_active_depth');
const queueFailed = new Trend('queue_failed_depth');

function observeQueueDepth() {
  const res = authGet('/videos/queue/status', {
    tags: { name: 'GET /videos/queue/status' },
  });
  statusErrors.add(res.status >= 500);

  let parsed = false;
  if (res.status === 200) {
    try {
      const body = JSON.parse(res.body);
      if (typeof body?.waiting === 'number') queueWaiting.add(body.waiting);
      if (typeof body?.active === 'number') queueActive.add(body.active);
      if (typeof body?.failed === 'number') queueFailed.add(body.failed);
      parsed = true;
    } catch {
      parsed = false;
    }
  }

  check(res, {
    'queue status: not 5xx (Redis/BullMQ up)': (r) => r.status < 500,
    'queue status: 200 with depth counts': () => parsed,
  });
}

export function queueBacklog() {
  const jar = ensureAuthenticated();
  if (!jar) {
    // No session → both routes are behind AuthGuard. Loud failure, not silent.
    enqueueErrors.add(true);
    statusErrors.add(true);
    return;
  }

  // 1. Enqueue a render job onto the BullMQ `video-render` queue (only if an
  //    enqueue target is configured — see the OBSERVE-ONLY note above).
  if (VIDEO_ID) {
    const res = authPost(
      `/videos/${VIDEO_ID}/export`,
      {},
      { tags: { name: 'POST /videos/:id/export (enqueue)' } }
    );
    // A 5xx is the enqueue path failing under flood — the real failure.
    enqueueErrors.add(res.status >= 500);
    check(res, {
      // 200/201 = queued. 4xx = K6_VIDEO_ID wrong/incomplete (config, not a
      // server fault) — flagged here so a mis-set id is obvious, but not counted
      // as a server error. Never 5xx.
      'enqueue: queued (2xx) or clean 4xx, never 5xx': (r) =>
        (r.status >= 200 && r.status < 300) ||
        (r.status >= 400 && r.status < 500),
      'enqueue: not 5xx': (r) => r.status < 500,
    });
  }

  // 2. Observe queue depth every iteration so the backlog curve is captured
  //    whether or not we're enqueuing. This is the back-pressure signal: under a
  //    sustained enqueue flood with a fixed worker pool, `waiting` should plateau
  //    (workers keeping up) rather than grow without bound.
  observeQueueDepth();

  // Pace the loop; the arrival-rate executor (scripts/backlog.js) controls the
  // offered enqueue rate. Keep this modest so we don't DLQ-flood a shared target.
  sleep(1);
}
