import { check, sleep } from 'k6';
import http from 'k6/http';
import { Rate, Trend } from 'k6/metrics';
import { ensureAuthenticated, sessionCookieHeader } from '../helpers/auth.js';
import { API_URL } from '../helpers/config.js';

/**
 * Assistant-chat SSE stream soak scenario.
 *
 * Opens concurrent, long-lived Server-Sent-Events streams against the real
 * assistant chat route and holds them to completion. Targets the
 * long-lived-connection risk called out in the release-safety strategy
 * (Pillar 3): sockets, the Anthropic client, and the DB connection a turn
 * holds open for up to 180s.
 *
 * ─── CONFIRMED REAL ENDPOINT ─────────────────────────────────────────────────
 *   POST /assistant/chat
 *     apps/api/src/assistant/assistant-chat.controller.ts:300 (@Post('chat'),
 *     @Controller('assistant'), @UseGuards(AuthGuard)).
 *   Response: text/event-stream, HTTP 200, header
 *     `x-vercel-ai-ui-message-stream: v1`
 *     (apps/api/src/assistant/lib/emit-ui-stream-event.ts:69-92), held open up
 *     to STREAM_TIMEOUT_MS = 180_000 (assistant-chat.controller.ts:91,332).
 *   Request body shape: { messages: UIMessage[], conversationId?, ... }
 *     (assistant-chat.controller.ts:301-324).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Preconditions the controller enforces (assistant-chat.controller.ts):
 *   - AuthGuard: a valid session (handled by ensureAuthenticated()).
 *   - An ACTIVE ORGANIZATION on the session, else 400 NO_ACTIVE_ORG (:345).
 *   - Plan with assistant access, else 403 NO_ACCESS (:388).
 *   - Daily/monthly message quota, else 429 DAILY_LIMIT / MONTHLY_LIMIT
 *     (:403-419).
 *
 * ─── UNVERIFIABLE WITHOUT A LIVE TARGET ──────────────────────────────────────
 * Each request consumes a real assistant message AND a real Anthropic call
 * (latency + tool loop + token cost). To run this meaningfully the load-test org
 * MUST have assistant access and a quota high enough that the soak doesn't
 * immediately 429 — and a target with ANTHROPIC_API_KEY set. We CANNOT verify
 * the stream behaviour here (no target, no key). The `assistantStream` p95 bound
 * (helpers/config.js) is a placeholder ≤ the 180s stream timeout; re-tune once a
 * dedicated target + a quota-exempt or high-quota load-test org exists. Consider
 * a dedicated `/testing`-style assistant echo route to avoid burning model cost.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const streamErrorRate = new Rate('assistant_stream_error_rate');
const streamDuration = new Trend('assistant_stream_duration', true);
// Track quota/access rejections separately so a fully-throttled run is
// diagnosable ("everything 429'd" != "everything errored").
const quotaRejectedRate = new Rate('assistant_quota_rejected_rate');

// A short, cheap prompt keeps the model turn fast while still exercising the
// full stream open → tool-loop-eval → close path. Unique suffix avoids any
// server-side response caching masking the stream.
function buildBody() {
  return {
    messages: [
      {
        role: 'user',
        // UIMessage `parts` shape (AI SDK v5). The controller extracts text via
        // extractTextFromMessage, which tolerates both `content` and `parts`.
        parts: [
          {
            type: 'text',
            text: `Load-test ping ${__VU}-${__ITER}-${Date.now()}: reply with one short sentence.`,
          },
        ],
      },
    ],
  };
}

export function assistantStream() {
  const jar = ensureAuthenticated();
  if (!jar) {
    streamErrorRate.add(true);
    return;
  }

  // k6's http.post BLOCKS until the response body is fully received. For an SSE
  // response that means it returns when the server closes the stream (finish
  // event → res.end), i.e. it holds the long-lived connection for us. We give
  // it a generous per-request timeout matching the server's 180s stream cap.
  const res = http.post(
    `${API_URL}/assistant/chat`,
    JSON.stringify(buildBody()),
    {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...sessionCookieHeader(),
      },
      timeout: '185s',
      // A streamed 200 is the success; 429/403/400 are CLEAN rejections (quota
      // exhausted mid-soak, no assistant access, or no active org) — expected,
      // not failures of the streaming path. Declaring them expected keeps the
      // gated http_req_failed{assistant_stream} threshold meaningful: it counts
      // only real stream failures (5xx, or a 200 that didn't stream). A
      // quota-exhausted soak therefore won't false-red the run; the quota signal
      // lives in assistant_quota_rejected_rate instead.
      responseCallback: http.expectedStatuses(200, 400, 403, 429),
      tags: { name: 'POST /assistant/chat (SSE)' },
    }
  );

  streamDuration.add(res.timings.duration);

  // Access/quota rejections are EXPECTED if the org isn't provisioned for this
  // soak — record them, but don't count them as stream errors (they're clean
  // rejections, not failures of the streaming path).
  const isQuotaOrAccess =
    res.status === 429 || res.status === 403 || res.status === 400;
  quotaRejectedRate.add(isQuotaOrAccess);

  const ok = check(res, {
    'assistant: 200 OR clean reject (429/403/400)': (r) =>
      r.status === 200 ||
      r.status === 429 ||
      r.status === 403 ||
      r.status === 400,
    'assistant: not 5xx': (r) => r.status < 500,
    'assistant: SSE content-type when streamed': (r) =>
      r.status !== 200 ||
      (r.headers['Content-Type'] || '').includes('text/event-stream'),
    'assistant: stream produced events when streamed': (r) =>
      r.status !== 200 || r.body?.includes('data:'),
  });

  // A stream error = the streaming path itself failed (5xx, or a 200 that
  // didn't actually stream). Quota/access rejections are not stream errors.
  streamErrorRate.add(!ok && !isQuotaOrAccess);

  // Pace concurrent streams; real users don't fire back-to-back turns.
  sleep(1);
}
