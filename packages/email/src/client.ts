import { randomUUID } from 'node:crypto';
import { emailEnv } from '@borradh-workspace/env/email';
import { getRedis } from '@borradh-workspace/redis';
import { Resend } from 'resend';
import { ResendSendError } from './errors.js';

let resendClient: Resend | null = null;

/**
 * Get the Resend client instance (singleton).
 */
export function getResendClient(): Resend {
  if (!resendClient) {
    resendClient = new Resend(emailEnv.RESEND_API_KEY);
  }
  return resendClient;
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * Resend enforces a hard 10 requests/second cap, account-wide. Every send
 * path in this package (campaigns, sequences, transactional) shares one
 * Resend account, so a burst from any one of them — or several concurrently,
 * across every API/worker replica — can blow past it; Resend's rejection is
 * unforgiving ("Too many requests. You can only make 10 requests per
 * second.") and, upstream, campaign sends were treating that rejection as a
 * permanent per-recipient failure with no retry (see `sendCampaignMessage`).
 *
 * `sendResendEmail` is the one choke point every `resend.emails.send` call in
 * this package goes through, so the cap is respected regardless of caller —
 * and regardless of which process makes the call. The budget lives in Redis
 * (already a hard dependency here, same as BullMQ), not in local memory, so
 * every replica shares one real count against Resend's account-wide limit
 * instead of each independently believing it has its own 9/s to spend.
 *
 * A caller that doesn't get a slot is NOT rejected — it waits (polling at
 * `RESEND_RATE_POLL_MS`) until one frees up. Bulk sends are the whole reason
 * this exists; failing them outright would just reintroduce the original bug.
 *
 * The wait IS bounded, though (`RESEND_RATE_MAX_WAIT_MS`) — this budget is
 * global to every process sharing this Redis instance, which in the preview
 * fleet means every concurrently-open PR preview. A synchronous, user-facing
 * send (e.g. sign-up's verification email, awaited and re-thrown on failure
 * by `packages/auth`) can't be left waiting on a queue that a *different*
 * preview's bulk-campaign burst happens to be saturating — that turns a
 * request that used to fail fast into one that hangs past whatever timeout
 * the caller (HTTP client, Playwright, a reverse proxy) enforces, which is
 * strictly worse. Past the bound, `sendResendEmail` throws a `ResendSendError`
 * with the same `retryable`-shaped code a real Resend 429 gets, so a
 * background caller (the campaign worker) still retries it exactly as before;
 * a synchronous caller just fails fast and predictably instead of hanging.
 */
const RESEND_MAX_PER_SECOND = 9; // stay under Resend's stated 10/s cap
const RESEND_RATE_WINDOW_MS = 1000;
const RESEND_RATE_KEY = 'email:resend:rate';
const RESEND_RATE_POLL_MS = 100;
const RESEND_RATE_MAX_WAIT_MS = 15_000;

// Resend represents failures in its own email-processing pipeline as
// `application_error` / `internal_server_error`. They are 5xx responses, so
// retrying the exact same logical send is appropriate; validation and sender
// configuration errors remain terminal. Keep the idempotency key stable for
// every attempt so a response lost after Resend accepted the request cannot
// result in a duplicate email.
const RESEND_TRANSIENT_ERROR_CODES = new Set([
  'application_error',
  'internal_server_error',
]);
const RESEND_MAX_SEND_ATTEMPTS = 3;
const RESEND_RETRY_BASE_DELAY_MS = 250;

// Atomically drop entries older than the window, count what's left, and admit
// this attempt only if under budget — one Redis round trip, safe under
// concurrent callers across every process sharing this Redis instance. A
// plain "read the count, then write" done in JS would race between replicas.
const RESEND_RATE_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)
if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window * 2)
  return 1
end
return 0
`;

async function tryClaimRateLimitSlot(): Promise<boolean> {
  const result = await getRedis().eval(
    RESEND_RATE_LUA,
    1,
    RESEND_RATE_KEY,
    Date.now(),
    RESEND_RATE_WINDOW_MS,
    RESEND_MAX_PER_SECOND,
    randomUUID()
  );
  return result === 1;
}

async function waitForRateLimitSlot(): Promise<void> {
  const deadline = Date.now() + RESEND_RATE_MAX_WAIT_MS;
  while (!(await tryClaimRateLimitSlot())) {
    if (Date.now() >= deadline) {
      throw new ResendSendError(
        `Timed out after ${RESEND_RATE_MAX_WAIT_MS}ms waiting for a Resend rate-limit slot`,
        'client_rate_limit_timeout'
      );
    }
    await new Promise((resolve) => setTimeout(resolve, RESEND_RATE_POLL_MS));
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Rate-limited, idempotent wrapper around `resend.emails.send`.
 *
 * A Resend 5xx means its delivery pipeline failed to process the request, not
 * that the recipient or sender is invalid. Retry those transient failures with
 * the same idempotency key. Every physical attempt claims a fresh shared rate
 * limit slot, preventing retries from bypassing the account-wide cap.
 */
export async function sendResendEmail(
  payload: Parameters<Resend['emails']['send']>[0],
  options?: Parameters<Resend['emails']['send']>[1]
): ReturnType<Resend['emails']['send']> {
  const requestOptions = {
    ...options,
    idempotencyKey: options?.idempotencyKey ?? randomUUID(),
  };

  for (let attempt = 1; ; attempt += 1) {
    await waitForRateLimitSlot();
    const response = await getResendClient().emails.send(
      payload,
      requestOptions
    );

    if (
      !response.error ||
      !RESEND_TRANSIENT_ERROR_CODES.has(response.error.name) ||
      attempt === RESEND_MAX_SEND_ATTEMPTS
    ) {
      return response;
    }

    // Exponential backoff is deliberately short: transactional sends should
    // recover from a one-off provider blip without making the originating API
    // request wait for a long-lived background job.
    await sleep(RESEND_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
  }
}

export function getDefaultFrom(): string {
  return `${emailEnv.EMAIL_FROM_NAME} <${emailEnv.EMAIL_FROM_ADDRESS}>`;
}

/**
 * Test email connection by verifying the Resend API key.
 */
export async function testConnection(): Promise<void> {
  const client = getResendClient();
  const { error } = await client.domains.list();
  if (error) {
    throw new Error(`Resend connection failed: ${error.message}`);
  }
}
