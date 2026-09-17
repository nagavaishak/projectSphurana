/**
 * `callGeminiImage` — shared multi-image call to Google's image-generation
 * models ("nano banana" family) via the public REST endpoint.
 *
 * Unlike `generateAiImage` (text-only, hardcoded to gemini-2.5-flash-image),
 * this accepts a `model` and an ordered list of input images passed as
 * `inlineData` parts — the mechanism that lets the model copy the visual
 * style of a reference and/or composite a real subject photo into the output.
 *
 * Models:
 *   - gemini-3-pro-image      "Nano Banana Pro" — best text rendering (default)
 *   - gemini-3.1-flash-image  Gemini web-app parity, cheaper
 *   - gemini-2.5-flash-image  legacy — garbles long text, do not use
 *
 * PROVIDER: either Google AI Studio (API key) or Vertex AI (service account),
 * chosen by `resolveGeminiProvider()`. This is a billing decision — only the
 * Vertex path can spend Google Cloud credits. See `vertex-auth.ts`.
 *
 * Returns raw PNG bytes (the model returns inlineData image parts). The caller
 * uploads + signs. Mirrors the prototype's `nanoBanana` helper.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { apiEnv } from '@borradh-workspace/env/api';
import { fetchWithTimeout } from '@borradh-workspace/http';
import {
  captureAiGeneration,
  trackEvent,
} from '@borradh-workspace/observability';
import { type Redis, getRedis } from '@borradh-workspace/redis';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  isGeminiBillingLimitError,
  ok,
} from '../shared/index.js';
import { estimateGeminiImageCost } from './gemini-image-pricing.js';
import {
  getVertexAccessToken,
  resolveGeminiProvider,
  vertexGenerateContentUrl,
} from './vertex-auth.js';

export const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-3-pro-image';
/**
 * A distinct model used only when the primary image model returns a successful
 * response with no image output after its bounded same-model retries. This is
 * deliberately not used for content-safety blocks: a different model must not
 * be used to bypass a provider safety decision.
 */
export const GEMINI_IMAGE_NO_OUTPUT_FALLBACK_MODEL = 'gemini-3.1-flash-image';

export interface GeminiImageInput {
  data: string; // base64 (no data: prefix)
  mediaType: string; // e.g. image/png, image/jpeg
}

const geminiImageEndpoint = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

/**
 * Resolve the endpoint + auth headers for the active provider.
 *
 * AI Studio authenticates with an API key on the query string; Vertex uses an
 * OAuth bearer token against a project-scoped publisher-model URL. Returns a
 * typed failure rather than throwing so the caller can emit its observability
 * event and return a `Result`, like every other failure path in this file.
 */
async function resolveGeminiTransport(
  model: string
): Promise<
  | { ok: true; url: string; headers: Record<string, string> }
  | { ok: false; reason: string }
> {
  if (resolveGeminiProvider() === 'vertex') {
    if (!apiEnv.GOOGLE_CLOUD_PROJECT) {
      return { ok: false, reason: 'GOOGLE_CLOUD_PROJECT is not configured' };
    }
    const token = await getVertexAccessToken();
    if (!token) {
      return { ok: false, reason: 'could not obtain a Vertex AI access token' };
    }
    return {
      ok: true,
      url: vertexGenerateContentUrl(model),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
    };
  }

  const apiKey = apiEnv.GOOGLE_GENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: 'GOOGLE_GENAI_API_KEY is not configured' };
  }
  return {
    ok: true,
    url: `${geminiImageEndpoint(model)}?key=${apiKey}`,
    headers: { 'content-type': 'application/json' },
  };
}

/** Transport-level retry for the Gemini image endpoint. */
const GEMINI_MAX_ATTEMPTS = 3;
/** Per-attempt ceiling. Image generation is slow, so this is generous —
 *  it exists to stop a hung request pinning the job forever, not to be tight. */
const GEMINI_ATTEMPT_TIMEOUT_MS = 120_000;
const GEMINI_RETRY_BASE_DELAY_MS = 1000;
/** HTTP statuses worth retrying — transient overload / gateway (429 has its own path). */
const GEMINI_RETRYABLE_STATUSES = new Set([408, 500, 502, 503, 504]);

/**
 * 429s get a dedicated, more patient retry path: up to 5 attempts with
 * full-jitter exponential backoff (capped per-delay at 30s), honoring the
 * server's `Retry-After` header / `RetryInfo.retryDelay` body detail as a
 * floor, with a total client-side retry budget of ~60s so a rate-limit storm
 * can't hold a worker job hostage — after that the job-level BullMQ retry
 * (with the worker limiter shaping throughput) takes over.
 */
const GEMINI_429_MAX_ATTEMPTS = 5;
const GEMINI_429_MAX_DELAY_MS = 30_000;
const GEMINI_429_TOTAL_BUDGET_MS = 60_000;

/**
 * Gemini limits image requests, while the previous BullMQ limiter counted
 * graphic jobs. A carousel job can make up to seven requests, so allowing 20
 * jobs per minute could issue 140 Gemini calls per minute and exhaust a much
 * smaller model quota. Reserve each outbound request in Redis instead; this
 * makes the limit atomic and shared across every worker replica.
 *
 * The daily budget is COUNTED here too, because the per-minute window says
 * nothing about it — 8/min sustained is 11,520/day against a 250/day model
 * quota. It is only ENFORCED when `GEMINI_IMAGE_REQUESTS_PER_DAY` is set above
 * zero. That is deliberate: production demand currently runs well past the
 * provider's daily quota, so a cap below demand would refuse real work that
 * the provider might still have served, and would hide the shortfall behind
 * our own error instead of surfacing it. Count first, decide the number from
 * the count, then set it.
 */
const GEMINI_IMAGE_RATE_WINDOW_MS = 60_000;
const GEMINI_IMAGE_RATE_KEY_PREFIX = 'gemini:image:requests';
const GEMINI_IMAGE_DAY_KEY_PREFIX = 'gemini:image:requests:day';
/**
 * Outlive the day bucket comfortably: the key is already scoped by calendar
 * day, so the TTL is only there to stop abandoned buckets accumulating.
 */
const GEMINI_IMAGE_DAY_KEY_TTL_MS = 36 * 60 * 60 * 1000;

/**
 * Google's per-day image quota resets at midnight US/Pacific, not UTC. Bucket
 * the day counter on that same boundary so our ceiling lifts when the real one
 * does instead of drifting up to eight hours away from it.
 */
export function geminiQuotaDayKey(now = new Date()): string {
  // en-CA renders ISO-ordered YYYY-MM-DD, which sorts and reads sanely in Redis.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

type RedisRateLimitClient = Pick<Redis, 'eval'>;

export interface GeminiImageReservation {
  allowed: boolean;
  /** How long to wait before the per-minute window could admit this request. */
  retryAfterMs: number;
  /**
   * True when the DAY budget refused. Waiting cannot help before the quota
   * resets, so callers must give up immediately rather than burn their
   * admission ceiling on a window that will refuse them again.
   */
  dayExhausted: boolean;
  /**
   * Requests reserved so far in the current Pacific day, counted whether or
   * not a daily cap is configured. This is the number that tells you what the
   * provider quota actually needs to be.
   */
  dayCount: number;
}

/**
 * Atomically reserve one request against the per-minute window AND the per-day
 * budget. A refusal gives back whatever it provisionally took, so a saturated
 * minute never silently eats into the day's allowance. Exported for
 * deterministic tests; callers refused on the minute wait `retryAfterMs`
 * before attempting another reservation.
 */
export async function reserveGeminiImageRequestSlot(
  redis: RedisRateLimitClient,
  quotaKey: string,
  maxRequests: number,
  maxRequestsPerDay: number,
  windowMs = GEMINI_IMAGE_RATE_WINDOW_MS
): Promise<GeminiImageReservation> {
  const result = (await redis.eval(
    `local dayCount = redis.call('INCR', KEYS[2])
if dayCount == 1 then redis.call('PEXPIRE', KEYS[2], ARGV[4]) end
local dayMax = tonumber(ARGV[2])
if dayMax > 0 and dayCount > dayMax then
  redis.call('DECR', KEYS[2])
  return { 0, redis.call('PTTL', KEYS[2]), 1, dayCount - 1 }
end
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[3]) end
local ttl = redis.call('PTTL', KEYS[1])
if count <= tonumber(ARGV[1]) then return { 1, ttl, 0, dayCount } end
redis.call('DECR', KEYS[1])
redis.call('DECR', KEYS[2])
return { 0, ttl, 0, dayCount - 1 }`,
    2,
    `${GEMINI_IMAGE_RATE_KEY_PREFIX}:${quotaKey}`,
    `${GEMINI_IMAGE_DAY_KEY_PREFIX}:${quotaKey}:${geminiQuotaDayKey()}`,
    String(maxRequests),
    String(maxRequestsPerDay),
    String(windowMs),
    String(GEMINI_IMAGE_DAY_KEY_TTL_MS)
  )) as [number, number, number, number];

  // Redis reports -1 (key has no TTL) and -2 (key is gone) around expiry.
  // `Number(ttl) || windowMs` would pass -1 straight through as truthy and a
  // later clamp collapses it to a 10ms sleep — thousands of round-trips over
  // the wait ceiling. A window we cannot measure is a WHOLE window, not zero.
  const ttl = Number(result[1]);
  return {
    allowed: Number(result[0]) === 1,
    retryAfterMs: ttl > 0 ? Math.max(10, ttl) : windowMs,
    dayExhausted: Number(result[2]) === 1,
    dayCount: Number(result[3]),
  };
}

/**
 * Parse the server-advised retry delay from a 429 response: the standard
 * `Retry-After` header (seconds or HTTP-date) or Google's
 * `RetryInfo.retryDelay` detail (e.g. `"retryDelay": "3.5s"`) in the JSON
 * error body. Exported for tests.
 */
export function parseRetryAfterMs(
  response: Response,
  bodyText: string
): number | undefined {
  const header = response.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (!Number.isNaN(seconds)) return Math.max(0, seconds * 1000);
    const dateMs = Date.parse(header);
    if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  }
  const match = bodyText.match(/"retryDelay"\s*:\s*"([\d.]+)s"/);
  if (match) return Math.round(Number(match[1]) * 1000);
  return undefined;
}

/**
 * Call-level retry for the empty-image (`no_image_part`) outcome — distinct
 * from the transport retry above. A 200-OK response that parses to only a text
 * part is a non-deterministic soft-refusal (transient safety / the model just
 * didn't emit an image this time); re-issuing the SAME request usually yields
 * an image. We retry the whole request a bounded number of extra times before
 * returning a terminal error.
 */
const GEMINI_EMPTY_IMAGE_MAX_RETRIES = 2;
const GEMINI_EMPTY_IMAGE_RETRY_DELAY_MS = 800;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Total time a SINGLE request may spend waiting for an admission slot. The
 * window is 60s, so this allows roughly two windows of queueing before the
 * request gives up. Without a ceiling a saturated limiter would hold a worker
 * slot indefinitely: the loop below sleeps for a full window each time it is
 * refused, and a busy carousel can refuse many times in a row.
 */
const GEMINI_IMAGE_ADMISSION_MAX_WAIT_MS = 120_000;

/**
 * Spread the herd. Every waiter refused in the same window sleeps for the same
 * remaining PTTL, so without jitter they all wake on the same millisecond, the
 * first N win, and the rest sleep another whole window. A few seconds of
 * randomness turns that stampede into a queue.
 */
const GEMINI_IMAGE_ADMISSION_JITTER_MS = 3_000;

/**
 * A job-scoped admission budget, shared by every request the job makes.
 *
 * The per-request ceiling above is not sufficient on its own: a carousel fans
 * out into up to seven images, and 7 x 120s of admission waiting is ~14
 * minutes — past the graphic queue's 600s `lockDuration`. BullMQ would mark
 * the job stalled and re-run it WHILE the original was still going, spending
 * exactly the duplicate Gemini quota this limiter exists to protect. Callers
 * that hold a lock (the video worker) wrap the whole job in a budget derived
 * from that lock, and every nested request shares it.
 */
const geminiImageAdmissionBudget = new AsyncLocalStorage<{
  deadline: number;
}>();

/**
 * Run `fn` with a total admission-wait budget of `budgetMs` shared across every
 * Gemini image request it makes, however deep. Pass a value comfortably inside
 * whatever lease the caller holds (queue lock, HTTP timeout).
 */
export function runWithGeminiImageAdmissionBudget<T>(
  budgetMs: number,
  fn: () => Promise<T>
): Promise<T> {
  return geminiImageAdmissionBudget.run(
    { deadline: Date.now() + budgetMs },
    fn
  );
}

/**
 * Wait for the globally shared quota before each real provider request.
 *
 * Returns false when the request could not be admitted inside the ceiling
 * above (or the ambient job budget, whichever is sooner); the caller turns that
 * into a 429 so the existing rate-limit path hands the work back to the BullMQ
 * retry rather than spending provider quota we know we do not have.
 *
 * Redis is a safety mechanism here, not a dependency: when it is not
 * configured (local runs, unit tests) or is unreachable, admission is skipped
 * and behaviour is exactly what it was before this limiter existed.
 */
async function waitForGeminiImageRequestSlot(
  quotaKey: string
): Promise<{ admitted: boolean; dayExhausted: boolean }> {
  // Gate on configuration rather than NODE_ENV: the limiter is meaningful
  // exactly when a shared Redis exists, and this keeps the production code
  // path free of a "am I under test" branch.
  if (!process.env.REDIS_URL) return { admitted: true, dayExhausted: false };

  // The tighter of the two bounds wins: one request never waits longer than
  // its own ceiling, and the job as a whole never outlives its lock.
  const jobDeadline = geminiImageAdmissionBudget.getStore()?.deadline;
  const deadline = Math.min(
    Date.now() + GEMINI_IMAGE_ADMISSION_MAX_WAIT_MS,
    jobDeadline ?? Number.POSITIVE_INFINITY
  );

  try {
    const redis = getRedis();
    while (true) {
      const reservation = await reserveGeminiImageRequestSlot(
        redis,
        quotaKey,
        apiEnv.GEMINI_IMAGE_REQUESTS_PER_MINUTE,
        apiEnv.GEMINI_IMAGE_REQUESTS_PER_DAY
      );
      if (reservation.allowed) return { admitted: true, dayExhausted: false };
      // The daily budget does not reset within any wait we could survive, so
      // hand the job back now instead of sleeping out the ceiling first.
      if (reservation.dayExhausted) {
        // Loud, because this one is a configured ceiling refusing real work
        // rather than the provider throttling us — the number is ours to fix.
        console.warn(
          `[gemini-image] daily admission cap reached for ${quotaKey}: ${reservation.dayCount} requests reserved today, cap is ${apiEnv.GEMINI_IMAGE_REQUESTS_PER_DAY}`
        );
        return { admitted: false, dayExhausted: true };
      }

      const wait =
        reservation.retryAfterMs +
        Math.round(Math.random() * GEMINI_IMAGE_ADMISSION_JITTER_MS);
      if (Date.now() + wait >= deadline)
        return { admitted: false, dayExhausted: false };
      await sleep(wait);
    }
  } catch (error) {
    // Do not turn a Redis incident into an image-generation outage. The
    // provider retry path below remains the fallback, and this warning makes
    // the missing protection visible without incorrectly blaming Gemini.
    console.warn(
      `[gemini-image] shared request limiter unavailable; proceeding without admission control: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return { admitted: true, dayExhausted: false };
  }
}

/**
 * POST to Gemini with a small retry budget. `fetch failed` (DNS/connection
 * resets between Fly and Google) and transient 5xx/429 responses are retried
 * with exponential backoff; everything else returns on the first attempt.
 * Returns either the final Response or the last transport error.
 */
type GeminiFetchResult =
  | { response: Response }
  | { error: unknown }
  /**
   * Local admission control refused before any socket was opened. This is
   * deliberately NOT a synthetic 429 Response: the caller's observability
   * treats a Response as evidence the request reached Gemini, and would bill
   * a phantom input-image cost for a call that never left the process.
   */
  | { admissionRefused: true; dayExhausted: boolean };

async function fetchGeminiWithRetry(
  url: string,
  body: string,
  headers: Record<string, string>,
  quotaKey: string
): Promise<GeminiFetchResult> {
  let lastError: unknown;
  let transientAttempts = 0;
  let rateLimitAttempts = 0;
  let rateLimitSleptMs = 0;

  while (true) {
    let response: Response;
    try {
      // Admission is immediately before fetch so every transport retry and
      // every 429 retry is also quota-shaped, not merely the initial call.
      const admission = await waitForGeminiImageRequestSlot(quotaKey);
      if (!admission.admitted) {
        // Refused inside the ceiling. Handing the work back rather than
        // waiting on keeps the worker slot free and lets the BullMQ retry,
        // which is rate-shaped and far more patient, own the wait.
        return {
          admissionRefused: true,
          dayExhausted: admission.dayExhausted,
        };
      }
      // Hard per-attempt timeout. The bespoke retry below already covers
      // transport failures and 429s, but an image generation that never
      // answers had nothing to bound it — the request just hung, holding the
      // job open indefinitely. A timeout surfaces as FetchTimeoutError, which
      // the `catch` treats as transient and retries like any other.
      response = await fetchWithTimeout(url, {
        method: 'POST',
        headers,
        body,
        timeoutMs: GEMINI_ATTEMPT_TIMEOUT_MS,
      });
    } catch (e) {
      // Network-level failure (`fetch failed`). Retry until budget exhausted.
      lastError = e;
      transientAttempts++;
      if (transientAttempts >= GEMINI_MAX_ATTEMPTS) return { error: lastError };
      await sleep(GEMINI_RETRY_BASE_DELAY_MS * 2 ** (transientAttempts - 1));
      continue;
    }

    // 429: dedicated backoff — full jitter, honoring the server's advised
    // delay as a floor, bounded by per-delay cap and total budget.
    if (response.status === 429) {
      rateLimitAttempts++;
      if (
        rateLimitAttempts >= GEMINI_429_MAX_ATTEMPTS ||
        rateLimitSleptMs >= GEMINI_429_TOTAL_BUDGET_MS
      ) {
        // Terminal for this call — return the (unread) response so the
        // caller can surface a typed RATE_LIMITED error.
        return { response };
      }
      // Read a clone so the caller can still consume the original response
      // when this is a terminal 429.
      const bodyText = await response
        .clone()
        .text()
        .catch(() => '');
      // A billing cap is returned as a 429 too, but retrying cannot change it.
      // Return immediately so the caller can produce a stable terminal result
      // instead of waiting through the transient-rate-limit retry budget.
      if (isGeminiBillingLimitError(bodyText)) return { response };
      const jittered =
        Math.min(GEMINI_429_MAX_DELAY_MS, 1000 * 2 ** rateLimitAttempts) *
        (0.5 + Math.random());
      const serverFloor = parseRetryAfterMs(response, bodyText) ?? 0;
      const delay = Math.min(
        Math.max(jittered, serverFloor),
        GEMINI_429_MAX_DELAY_MS,
        GEMINI_429_TOTAL_BUDGET_MS - rateLimitSleptMs
      );
      rateLimitSleptMs += delay;
      await sleep(delay);
      continue;
    }

    // Retry other transient HTTP failures; return anything else.
    if (
      GEMINI_RETRYABLE_STATUSES.has(response.status) &&
      transientAttempts < GEMINI_MAX_ATTEMPTS - 1
    ) {
      transientAttempts++;
      await response.body?.cancel().catch(() => {});
      await sleep(GEMINI_RETRY_BASE_DELAY_MS * 2 ** (transientAttempts - 1));
      continue;
    }
    return { response };
  }
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
}
interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
  promptFeedback?: { blockReason?: string };
}

export interface CallGeminiImageOptions {
  model?: string;
  prompt: string;
  /** Reference / subject images passed before the prompt as inlineData. */
  images?: GeminiImageInput[];
  /**
   * Output aspect ratio (e.g. '4:5', '1:1', '9:16'). Sent via
   * `generationConfig.imageConfig.aspectRatio` so the model composes at the
   * target shape — without it the model picks its own ratio and the caller is
   * forced to crop (which slices content). Gemini 3 image models support
   * 1:1, 2:3, 3:4, 4:5, 5:4, 3:2, 16:9, 9:16, 21:9.
   */
  aspectRatio?: string;
}

/**
 * Gemini occasionally returns HTTP 200 with text-only candidate parts for a
 * valid image request. Retrying that same model handles most occurrences, but
 * treating an exhausted retry budget as a terminal graphic failure makes one
 * provider's transient output omission customer-visible. Use a separately
 * served image model as a final, bounded recovery path for the production
 * default. Explicit model callers retain their requested model semantics.
 */
function noOutputFallbackFor(model: string): string | undefined {
  return model === DEFAULT_GEMINI_IMAGE_MODEL
    ? GEMINI_IMAGE_NO_OUTPUT_FALLBACK_MODEL
    : undefined;
}

/**
 * Build the `generateContent` request body.
 *
 * Extracted and exported so the payload SHAPE is testable without mocking the
 * HTTP layer — `vi.mock` leaks across files in this suite's `isolate: false`
 * mode, and the shape is exactly what broke on Vertex.
 *
 * `role` is REQUIRED by Vertex: it rejects a role-less content entry with
 * `400 INVALID_ARGUMENT: Please use a valid role: user, model.` The AI Studio
 * endpoint accepts the same payload WITHOUT it, so the omission was invisible
 * until the Vertex cutover and would have broken every image generation.
 * Sending it explicitly is valid on both providers.
 */
export function buildGeminiRequestBody(opts: {
  prompt: string;
  images?: GeminiImageInput[];
  aspectRatio?: string;
}): Record<string, unknown> {
  const parts: Record<string, unknown>[] = (opts.images ?? []).map((img) => ({
    inlineData: { mimeType: img.mediaType, data: img.data },
  }));
  // Reference/subject images come BEFORE the prompt — the model reads them as
  // context for the instruction that follows.
  parts.push({ text: opts.prompt });

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts }],
  };
  if (opts.aspectRatio) {
    body.generationConfig = {
      imageConfig: { aspectRatio: opts.aspectRatio },
    };
  }
  return body;
}

/**
 * Call a Gemini image model with a prompt and optional input images.
 * Returns the first image part as PNG-ish bytes (the model returns the
 * mimeType it chose; we hand bytes straight to the uploader as image/png —
 * callers store/serve as png, which browsers + Sharp handle regardless).
 */
export async function callGeminiImage(
  opts: CallGeminiImageOptions
): Promise<Result<{ png: Buffer; model: string }>> {
  const model = opts.model ?? DEFAULT_GEMINI_IMAGE_MODEL;
  const imageInputCount = opts.images?.length ?? 0;
  // Tagged on every event so the AI-Studio → Vertex cutover is verifiable in
  // PostHog: spend still on `aistudio` is spend NOT drawing down GCP credits.
  const provider = resolveGeminiProvider();
  // Quota is per provider AND per model: AI Studio project quota and Vertex
  // project quota are separate buckets, so one shared key would under-count
  // whichever provider is not in use today.
  const quotaKey = `${provider}:${model}`;
  // Set right before the HTTP request so `$ai_generation` latency reflects the
  // actual model call (incl. transport retries), not prompt validation.
  let apiStartedAt: number | null = null;

  // Emit one event per call so spend is observable in PostHog:
  // `apiCalled` is the billing-relevant flag (did the HTTP request actually
  // reach Gemini?), `outcome` + `httpStatus` capture the real failure cause
  // (e.g. http_error/429 = rate-limited, not billed; success/blocked/no_image
  // = the model ran). Charting count by environment shows how often the paid
  // image model is invoked, and from where (preview/CI vs production).
  //
  // `admission_refused` is the one outcome that never opened a socket: it MUST
  // pass apiCalled=false, or a saturated local limiter — precisely the state
  // this PR makes common under load — reports a fleet of billed Gemini errors
  // with phantom input-image cost and admission-wait time as latency.
  const emit = (
    outcome:
      | 'success'
      | 'no_api_key'
      | 'empty_prompt'
      | 'network_error'
      | 'http_error'
      | 'admission_refused'
      | 'blocked'
      | 'no_image_part',
    apiCalled: boolean,
    extra?: Record<string, string | number | boolean>
  ): void => {
    // System-level event with no acting user — keep it anonymous so it doesn't
    // create a nameless "image-generation" person profile.
    trackEvent(
      'image-generation',
      'imageGeneration.geminiImageCall',
      {
        model,
        provider,
        outcome,
        apiCalled,
        imageInputCount,
        aspectRatio: opts.aspectRatio ?? 'default',
        ...extra,
      },
      { personless: true }
    );

    // When the request actually reached the model, also emit a PostHog LLM
    // observability `$ai_generation` so Gemini image gen shows up in the
    // unified AI dashboards alongside OpenAI/Anthropic. Image models don't
    // report token usage over this REST endpoint and aren't in PostHog's price
    // catalog, so we attach an explicit per-image cost — otherwise PostHog
    // auto-prices them at $0. Only a `success` produced (and is billed for) an
    // output image; non-success outcomes that still reached the model
    // (blocked / no_image_part) are charged input-image cost only.
    if (apiCalled) {
      const succeeded = outcome === 'success';
      const cost = estimateGeminiImageCost(model, imageInputCount);
      captureAiGeneration({
        provider: 'gemini',
        model,
        spanName: 'imageGeneration.geminiImage',
        input: opts.prompt,
        latencySeconds:
          apiStartedAt !== null
            ? (Date.now() - apiStartedAt) / 1000
            : undefined,
        httpStatus:
          typeof extra?.httpStatus === 'number' ? extra.httpStatus : undefined,
        isError: !succeeded,
        error: succeeded ? undefined : outcome,
        inputCostUsd: cost.inputCostUsd,
        outputCostUsd: succeeded ? cost.outputCostUsd : 0,
        properties: {
          imageInputCount,
          aspectRatio: opts.aspectRatio ?? 'default',
          // NOTE: the `provider` field on the $ai_generation event stays
          // 'gemini' so PostHog's price lookup keeps resolving; the billing
          // route goes here as a plain property instead.
          geminiProvider: provider,
        },
      });
    }
  };

  // Resolve provider + credentials once, outside the retry loop. Vertex access
  // tokens are valid for ~1h, so a single mint covers every attempt.
  const transport = await resolveGeminiTransport(model);
  if (!transport.ok) {
    emit('no_api_key', false);
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        `Cannot generate images — ${transport.reason}.`
      )
    );
  }

  const prompt = opts.prompt.trim();
  if (!prompt) {
    emit('empty_prompt', false);
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'callGeminiImage requires a non-empty prompt.'
      )
    );
  }

  const body = buildGeminiRequestBody({
    prompt,
    images: opts.images,
    aspectRatio: opts.aspectRatio,
  });

  // Bounded call-level retry for the empty-image case only. Transport errors
  // (network / 5xx / 429) are still handled inside fetchGeminiWithRetry and are
  // terminal here; we only re-issue the request when the model returns a 200-OK
  // with no image part. Each attempt emits its own observability event so spend
  // stays tracked even across re-prompts.
  for (
    let imageAttempt = 0;
    imageAttempt <= GEMINI_EMPTY_IMAGE_MAX_RETRIES;
    imageAttempt++
  ) {
    apiStartedAt = Date.now();
    const fetchResult = await fetchGeminiWithRetry(
      transport.url,
      JSON.stringify(body),
      transport.headers,
      quotaKey
    );
    if ('admissionRefused' in fetchResult) {
      // No socket was opened, so no $ai_generation and no cost — just the
      // count, tagged so a saturated budget is distinguishable in PostHog
      // from Gemini actually rate-limiting us.
      emit('admission_refused', false, {
        dayExhausted: fetchResult.dayExhausted,
      });
      return err(
        new FeatureError(
          // Retryable: the queue's longer, rate-shaped backoff owns the wait.
          ErrorCodes.RATE_LIMITED,
          `Gemini image (${model}) refused locally: the shared ${
            fetchResult.dayExhausted ? 'daily' : 'per-minute'
          } image budget is saturated.`,
          { admissionRefused: true, dayExhausted: fetchResult.dayExhausted }
        )
      );
    }
    if ('error' in fetchResult) {
      const e = fetchResult.error;
      emit('network_error', false);
      return err(
        new FeatureError(
          // This must retain its external/transient identity through the
          // feature Result boundary. The graphic worker owns the longer
          // BullMQ retry window; collapsing an exhausted call-level retry to
          // INTERNAL_ERROR made a brief Gemini/network incident terminal for
          // the whole carousel after only this one invocation.
          ErrorCodes.EXTERNAL_SERVICE_ERROR,
          `Gemini image request failed: ${e instanceof Error ? e.message : String(e)}`
        )
      );
    }
    const response = fetchResult.response;

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      emit('http_error', true, { httpStatus: response.status });
      // Rate limit that survived the in-call backoff: surface a typed error
      // so the worker can rethrow for a BullMQ retry without marking the
      // graphic failed or notifying the user prematurely.
      if (response.status === 429) {
        return err(
          new FeatureError(
            ErrorCodes.RATE_LIMITED,
            `Gemini image API (${model}) rate-limited after retries (429): ${errBody.slice(0, 400)}`,
            { httpStatus: 429 }
          )
        );
      }
      return err(
        new FeatureError(
          // fetchGeminiWithRetry has already made the bounded in-call retries
          // for transient status codes. Preserve that this is a retryable
          // provider failure so the job queue can retry after its longer,
          // rate-shaped exponential backoff rather than failing the graphic.
          GEMINI_RETRYABLE_STATUSES.has(response.status)
            ? ErrorCodes.EXTERNAL_SERVICE_ERROR
            : ErrorCodes.INTERNAL_ERROR,
          `Gemini image API (${model}) returned ${response.status}: ${errBody.slice(0, 400)}`,
          { httpStatus: response.status }
        )
      );
    }

    const json = (await response.json()) as GeminiResponse;
    if (json.promptFeedback?.blockReason) {
      const blockReason = json.promptFeedback.blockReason;
      emit('blocked', true, { blockReason });
      // A content-safety block (e.g. `blockReason: 'OTHER'`) is a TERMINAL,
      // non-retryable refusal: re-issuing the identical request will be blocked
      // again, so we do NOT loop like the soft `no_image_part` case. Surface it
      // as AI_MODEL_REFUSED — a typed, graceful-degrade result the caller can
      // handle (skip the graphic / show a clear message) — rather than a hard
      // INTERNAL_ERROR that reads as a system bug and spams Sentry. The
      // `outcome`/`blockReason` tags let callers demote logging.
      return err(
        new FeatureError(
          ErrorCodes.AI_MODEL_REFUSED,
          `Gemini image (${model}) blocked by content safety: ${blockReason}`,
          { outcome: 'blocked', blockReason }
        )
      );
    }
    const outParts = json.candidates?.[0]?.content?.parts ?? [];
    const b64 = outParts.find(
      (p) =>
        p.inlineData?.data && (p.inlineData.mimeType ?? '').startsWith('image/')
    )?.inlineData?.data;
    if (b64) {
      emit('success', true, { imageAttempt: imageAttempt + 1 });
      return ok({ png: Buffer.from(b64, 'base64'), model });
    }

    // 200-OK but no image part — retry the whole request if budget remains.
    emit('no_image_part', true, { imageAttempt: imageAttempt + 1 });
    if (imageAttempt < GEMINI_EMPTY_IMAGE_MAX_RETRIES) {
      await sleep(GEMINI_EMPTY_IMAGE_RETRY_DELAY_MS * 2 ** imageAttempt);
    }
  }

  // The primary model repeatedly returned a successful but text-only response.
  // This is not a malformed request or a content-safety block, so use one
  // bounded attempt sequence on the alternate image model before failing the
  // graphic. Do not recurse from the fallback model: two models × three
  // attempts is the complete recovery budget for one generation request.
  const fallbackModel = noOutputFallbackFor(model);
  if (fallbackModel) {
    return callGeminiImage({ ...opts, model: fallbackModel });
  }

  // Exhausted the empty-image retry budget for every eligible model. This is
  // terminal for THIS call but recoverable at the job level (BullMQ retry /
  // user re-prompt), so surface it as AI_MODEL_REFUSED — not a hard
  // INTERNAL_ERROR — and tag the outcome so callers can demote logging and
  // avoid Sentry spam on a transient refusal.
  return err(
    new FeatureError(
      ErrorCodes.AI_MODEL_REFUSED,
      `Gemini image (${model}) returned no image part after ${
        GEMINI_EMPTY_IMAGE_MAX_RETRIES + 1
      } attempts.`,
      { outcome: 'no_image_part' }
    )
  );
}
