import { check, sleep } from 'k6';
import http from 'k6/http';
import { Rate } from 'k6/metrics';
import { API_URL } from '../helpers/config.js';

/**
 * Webhook ingestion scenario: simulates external callback payloads.
 *
 * Webhooks from Meta, Stripe, etc. must be parsed + verified + rejected
 * quickly. These endpoints don't require session auth but DO verify a
 * signature / verify-token, so we send deliberately-invalid payloads and
 * assert the server REJECTS them cleanly and fast (the smoke concern is
 * "the route exists, the verify path runs, and it responds — not a hang or
 * a crash"), NOT that processing succeeds.
 *
 * ─── REAL ROUTES (verified against borradh-api-loadtest, 2026-06-16) ─────────
 *   GET  /webhooks/meta/leadgen   — Meta webhook verify handshake. A bad
 *        hub.verify_token returns a CLEAN 403 (meta-webhooks.controller.ts:55).
 *        This is our primary, deterministic webhook probe.
 *   POST /webhooks/billing        — Stripe billing webhook
 *        (billing-webhooks.controller.ts:39). NOT probed here: on the current
 *        build a bad/missing stripe-signature returns 500, not 400, because
 *        handle-stripe-webhook.service.ts only maps the literal Stripe error
 *        message 'No signatures found' to INVALID_WEBHOOK_SIGNATURE (→400) and
 *        every other signature failure falls through to a generic 500. That's a
 *        real (minor) robustness bug in packages/features (FLAGGED — out of this
 *        window's scope), so we do not dress a known-500 path up as a passing
 *        smoke check. Re-add a Stripe probe here once that mapping is widened.
 *
 *   (Earlier versions of this scenario hit /webhooks/stripe and /webhooks/meta —
 *    neither path is mounted; both 404. The old 'not 5xx' check passed on the
 *    404s, masking that the probes hit nothing.)
 * ─────────────────────────────────────────────────────────────────────────────
 */

// A bad-verify-token rejection (403) is the EXPECTED, healthy outcome here, so
// surface it as its own signal rather than letting k6's default http_req_failed
// count it as a failure (it counts any >=400 as failed). We declare 403 an
// "expected status" per-request below; this metric just makes the reject
// explicit in the summary.
const webhookRejected = new Rate('webhook_rejected_rate');

export function webhookIngestion() {
  // Meta webhook verify handshake with a deliberately-wrong verify_token.
  // Healthy server → 403 (token mismatch), fast. We mark 403 as an expected
  // status so a clean rejection doesn't inflate http_req_failed; a 5xx or a
  // 404 (route gone) still counts as a failure and reddens the run.
  const metaVerifyRes = http.get(
    `${API_URL}/webhooks/meta/leadgen?hub.mode=subscribe&hub.challenge=loadtest123&hub.verify_token=loadtest-invalid`,
    {
      responseCallback: http.expectedStatuses(403),
      tags: { name: 'GET /webhooks/meta/leadgen (verify)' },
    }
  );

  webhookRejected.add(metaVerifyRes.status === 403);

  check(metaVerifyRes, {
    'meta verify: clean 403 (route exists, rejects bad token)': (r) =>
      r.status === 403,
    'meta verify: responds quickly': (r) => r.timings.duration < 500,
    'meta verify: not 5xx': (r) => r.status < 500,
  });

  sleep(0.5);

  // Health check (baseline for comparison — must always be 200).
  const healthRes = http.get(`${API_URL}/health`, {
    tags: { name: 'GET /health' },
  });

  check(healthRes, {
    'health: status 200': (r) => r.status === 200,
  });

  sleep(1);
}
