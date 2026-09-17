import {
  captureAiGeneration,
  trackEvent,
} from '@borradh-workspace/observability';
import { getRedis } from '@borradh-workspace/redis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../shared/index.js';
import {
  callGeminiImage,
  geminiQuotaDayKey,
  parseRetryAfterMs,
  reserveGeminiImageRequestSlot,
  runWithGeminiImageAdmissionBudget,
} from './gemini-image.js';

const make429 = (headers?: Record<string, string>, body = '{}') =>
  new Response(body, { status: 429, headers });

/** A 200-OK response carrying a single inline PNG image part. */
const makeImageSuccess = () =>
  new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: Buffer.from('fake-png').toString('base64'),
                },
              },
            ],
          },
        },
      ],
    }),
    { status: 200 }
  );

/** A 200-OK response that was blocked by content safety (no image part). */
const makeBlocked = (blockReason = 'OTHER') =>
  new Response(JSON.stringify({ promptFeedback: { blockReason } }), {
    status: 200,
  });

describe('parseRetryAfterMs', () => {
  it('parses a Retry-After seconds header', () => {
    expect(parseRetryAfterMs(make429({ 'retry-after': '7' }), '')).toBe(7000);
  });

  it('parses an HTTP-date Retry-After header', () => {
    const date = new Date(Date.now() + 10_000).toUTCString();
    const ms = parseRetryAfterMs(make429({ 'retry-after': date }), '');
    expect(ms).toBeGreaterThan(8000);
    expect(ms).toBeLessThanOrEqual(10_000);
  });

  it('parses Google RetryInfo retryDelay from the 429 JSON body', () => {
    const body = JSON.stringify({
      error: {
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.RetryInfo',
            retryDelay: '3.5s',
          },
        ],
      },
    });
    expect(parseRetryAfterMs(make429(), body)).toBe(3500);
  });

  it('returns undefined when no delay hint is present', () => {
    expect(parseRetryAfterMs(make429(), '{}')).toBeUndefined();
  });
});

describe('reserveGeminiImageRequestSlot', () => {
  const dayKey = `gemini:image:requests:day:aistudio:gemini-3-pro-image:${geminiQuotaDayKey()}`;

  it('reserves against the minute AND the day in one atomic call', async () => {
    const evalMock = vi
      .fn()
      .mockResolvedValueOnce([1, 60_000, 0, 12])
      .mockResolvedValueOnce([0, 59_000, 0, 12]);
    const redis = { eval: evalMock };

    await expect(
      reserveGeminiImageRequestSlot(
        redis as never,
        'aistudio:gemini-3-pro-image',
        8,
        240
      )
    ).resolves.toEqual({
      allowed: true,
      retryAfterMs: 60_000,
      dayExhausted: false,
      dayCount: 12,
    });
    await expect(
      reserveGeminiImageRequestSlot(
        redis as never,
        'aistudio:gemini-3-pro-image',
        8,
        240
      )
    ).resolves.toEqual({
      allowed: false,
      retryAfterMs: 59_000,
      dayExhausted: false,
      dayCount: 12,
    });

    expect(evalMock).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('INCR', KEYS[2])"),
      2,
      'gemini:image:requests:aistudio:gemini-3-pro-image',
      dayKey,
      '8',
      '240',
      '60000',
      String(36 * 60 * 60 * 1000)
    );
  });

  it('reports the daily budget separately from the per-minute one', async () => {
    const redis = { eval: vi.fn().mockResolvedValue([0, 4_000_000, 1, 240]) };

    await expect(
      reserveGeminiImageRequestSlot(
        redis as never,
        'aistudio:gemini-3-pro-image',
        8,
        240
      )
    ).resolves.toMatchObject({
      allowed: false,
      dayExhausted: true,
      dayCount: 240,
    });
  });

  it('treats an unmeasurable TTL as a whole window, not a busy-loop', async () => {
    // Redis answers -1 (key with no TTL) and -2 (key already gone) around
    // expiry. Both must back off for a full window: a 10ms retry would spin
    // thousands of round-trips across the wait ceiling.
    for (const ttl of [-1, -2, 0]) {
      const redis = { eval: vi.fn().mockResolvedValue([0, ttl, 0, 3]) };

      await expect(
        reserveGeminiImageRequestSlot(
          redis as never,
          'aistudio:gemini-3-pro-image',
          8,
          240
        )
      ).resolves.toMatchObject({ allowed: false, retryAfterMs: 60_000 });
    }
  });

  it('counts the day but never refuses on it when no cap is configured', async () => {
    // Production demand exceeds the provider's daily quota today, so the
    // shipped default only measures. The counter must still run — that number
    // is the evidence for how much quota to actually buy.
    const evalMock = vi.fn().mockResolvedValue([1, 60_000, 0, 517]);

    await expect(
      reserveGeminiImageRequestSlot(
        evalMock ? ({ eval: evalMock } as never) : (null as never),
        'aistudio:gemini-3-pro-image',
        8,
        0
      )
    ).resolves.toMatchObject({
      allowed: true,
      dayExhausted: false,
      dayCount: 517,
    });

    // The zero reaches the script, which is where "0 means do not enforce"
    // is decided — the JS side must not quietly substitute a ceiling.
    expect(evalMock.mock.calls[0]?.[5]).toBe('0');
    expect(evalMock.mock.calls[0]?.[0]).toContain('dayMax > 0');
  });

  it('buckets the day key on the Pacific reset Google actually uses', async () => {
    // 07:30 UTC on the 2nd is still the 1st in Los Angeles, which is the day
    // whose quota the request draws from.
    expect(geminiQuotaDayKey(new Date('2026-03-02T07:30:00Z'))).toBe(
      '2026-03-01'
    );
    expect(geminiQuotaDayKey(new Date('2026-03-02T09:30:00Z'))).toBe(
      '2026-03-02'
    );
  });
});

describe('callGeminiImage 429 backoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('retries a 429 up to 5 attempts then returns a typed RATE_LIMITED error', async () => {
    const fetchMock = vi.fn(async () => make429());
    vi.stubGlobal('fetch', fetchMock);

    const promise = callGeminiImage({ prompt: 'a test graphic' });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.RATE_LIMITED);
      expect(result.error.details).toMatchObject({ httpStatus: 429 });
    }
  });

  it('does not retry a permanent billing-exhaustion 429', async () => {
    const fetchMock = vi.fn(async () =>
      make429(
        undefined,
        JSON.stringify({
          error: {
            status: 'RESOURCE_EXHAUSTED',
            message:
              'Your prepayment credits are depleted. Manage your project and billing.',
          },
        })
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await callGeminiImage({ prompt: 'a test graphic' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.RATE_LIMITED);
    }
  });

  it('does not retry Google AI Studio monthly spending-cap 429s', async () => {
    const fetchMock = vi.fn(async () =>
      make429(
        undefined,
        JSON.stringify({
          error: {
            status: 'RESOURCE_EXHAUSTED',
            message:
              'Your billing account has exceeded its monthly spending cap. Please go to AI Studio at https://ai.studio/billing to manage your billing. Learn more at https://ai.google.dev/gemini-api/docs/billing#tier-spend-caps.',
          },
        })
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await callGeminiImage({ prompt: 'a test graphic' });

    // This is an account state, not transient API pressure; retrying spends
    // time and eventually creates a duplicate worker/Sentry failure.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.RATE_LIMITED);
      expect(result.error.details).toMatchObject({ httpStatus: 429 });
    }
  });

  it('honors Retry-After as a floor before re-attempting', async () => {
    const png = Buffer.from('fake-png').toString('base64');
    const success = new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { mimeType: 'image/png', data: png } }],
            },
          },
        ],
      }),
      { status: 200 }
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(make429({ 'retry-after': '10' }))
      .mockResolvedValueOnce(success);
    vi.stubGlobal('fetch', fetchMock);

    const promise = callGeminiImage({ prompt: 'a test graphic' });

    // Jittered backoff for attempt 1 is at most 3s; Retry-After of 10s must
    // win as the floor — no second request before 10s have elapsed.
    await vi.advanceTimersByTimeAsync(9_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const result = await promise;
    expect(result.success).toBe(true);
  });

  it('does not map non-429 HTTP errors to RATE_LIMITED', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = callGeminiImage({ prompt: 'a test graphic' });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('preserves an exhausted transient 500 as retryable external-service failure', async () => {
    const fetchMock = vi.fn(
      async () => new Response('temporarily overloaded', { status: 500 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const promise = callGeminiImage({ prompt: 'a test graphic' });
    await vi.runAllTimersAsync();
    const result = await promise;

    // The call-level budget is deliberately small. The queue worker must see
    // the typed external failure and use its longer retry window afterwards.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.EXTERNAL_SERVICE_ERROR);
      expect(result.error.details).toMatchObject({ httpStatus: 500 });
    }
  });

  it('retries a transient 429 twice then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(make429())
      .mockResolvedValueOnce(make429())
      .mockResolvedValueOnce(makeImageSuccess());
    vi.stubGlobal('fetch', fetchMock);

    const promise = callGeminiImage({ prompt: 'a test graphic' });
    await vi.runAllTimersAsync();
    const result = await promise;

    // Two 429s were retried (backoff) and the third attempt returned an image.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.png).toBeInstanceOf(Buffer);
      expect(result.data.png.length).toBeGreaterThan(0);
    }
  });
});

describe('callGeminiImage content-safety refusal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('degrades a content-safety block to a terminal AI_MODEL_REFUSED without throwing or retrying', async () => {
    const fetchMock = vi.fn(async () => makeBlocked('OTHER'));
    vi.stubGlobal('fetch', fetchMock);

    // Must not throw — the caller receives a typed Result it can handle.
    const result = await callGeminiImage({ prompt: 'a test graphic' });

    // Terminal: a content-safety block is not retried (re-issuing is pointless).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.AI_MODEL_REFUSED);
      expect(result.error.code).not.toBe(ErrorCodes.INTERNAL_ERROR);
      expect(result.error.details).toMatchObject({
        outcome: 'blocked',
        blockReason: 'OTHER',
      });
    }
  });
});

describe('callGeminiImage no-output model failover', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses the alternate image model after the primary returns no image three times', async () => {
    const noImage = new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Unable to generate.' }] } }],
      }),
      { status: 200 }
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(noImage.clone())
      .mockResolvedValueOnce(noImage.clone())
      .mockResolvedValueOnce(noImage.clone())
      .mockResolvedValueOnce(makeImageSuccess());
    vi.stubGlobal('fetch', fetchMock);

    const promise = callGeminiImage({ prompt: 'a test graphic' });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [url] of fetchMock.mock.calls.slice(0, 3)) {
      expect(url).toContain('gemini-3-pro-image:generateContent');
    }
    expect(fetchMock.mock.calls[3]?.[0]).toContain(
      'gemini-3.1-flash-image:generateContent'
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.model).toBe('gemini-3.1-flash-image');
      expect(result.data.png).toBeInstanceOf(Buffer);
    }
  });

  it('does not bypass a content-safety refusal with the fallback model', async () => {
    const fetchMock = vi.fn(async () => makeBlocked('OTHER'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callGeminiImage({ prompt: 'a test graphic' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.AI_MODEL_REFUSED);
    }
  });
});

describe('Gemini image admission control', () => {
  // The limiter is gated on Redis being configured rather than on NODE_ENV, so
  // these tests opt in explicitly. `unstubAllEnvs` restores the ambient value,
  // which matters because every other test in this file relies on REDIS_URL
  // being absent to skip admission control entirely.
  // `@borradh-workspace/redis` is canonically aliased, so drive the shared
  // mock rather than adding a file-local `vi.mock` — see
  // src/architecture/mock-boundaries.test.ts for why that leaks under
  // `isolate: false`.
  const redisEval = vi.mocked(getRedis)().eval;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    redisEval.mockReset();
    vi.mocked(trackEvent).mockClear();
    vi.mocked(captureAiGeneration).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    // The client is shared across every file in this worker; leaving a
    // resolved value on it would silently drive other suites' Redis calls.
    redisEval.mockReset();
  });

  it('refuses rather than waiting forever when the shared budget stays saturated', async () => {
    // Always over budget, and each refusal advises a full window. The wait
    // ceiling must end this instead of holding the worker slot indefinitely.
    redisEval.mockResolvedValue([0, 60_000, 0, 3]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const promise = callGeminiImage({ prompt: 'a test graphic' });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.RATE_LIMITED);
      expect(result.error.details).toMatchObject({
        admissionRefused: true,
        dayExhausted: false,
      });
    }
    // The whole point: quota we know we do not have is never spent.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never books a locally-refused request as billed Gemini spend', async () => {
    // A refusal opens no socket. Reporting it as a real API call would put a
    // fleet of phantom billed errors — with admission-wait time as latency and
    // input-image cost per carousel slide — into the AI cost dashboards
    // exactly when the limiter is doing its job.
    redisEval.mockResolvedValue([0, 60_000, 0, 3]);
    vi.stubGlobal('fetch', vi.fn());

    const promise = callGeminiImage({
      prompt: 'a test graphic',
      images: [{ data: 'AAA', mediaType: 'image/png' }],
    });
    await vi.runAllTimersAsync();
    await promise;

    // No $ai_generation at all: that event IS the cost record.
    expect(captureAiGeneration).not.toHaveBeenCalled();

    // The count still fires, flagged as never having reached the provider.
    const call = vi
      .mocked(trackEvent)
      .mock.calls.find((c) => c[1] === 'imageGeneration.geminiImageCall');
    expect(call?.[2]).toMatchObject({
      outcome: 'admission_refused',
      apiCalled: false,
      dayExhausted: false,
      imageInputCount: 1,
    });
  });

  it('distinguishes a daily refusal from a per-minute one in telemetry', async () => {
    redisEval.mockResolvedValue([0, 4_000_000, 1, 240]);
    vi.stubGlobal('fetch', vi.fn());

    const promise = callGeminiImage({ prompt: 'a test graphic' });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(captureAiGeneration).not.toHaveBeenCalled();
    const call = vi
      .mocked(trackEvent)
      .mock.calls.find((c) => c[1] === 'imageGeneration.geminiImageCall');
    expect(call?.[2]).toMatchObject({
      outcome: 'admission_refused',
      apiCalled: false,
      dayExhausted: true,
    });
    if (!result.success) {
      expect(result.error.message).toContain('daily');
    }
  });

  it('proceeds to the provider once a slot is granted', async () => {
    redisEval.mockResolvedValue([1, 60_000, 0, 3]);
    const fetchMock = vi.fn(async () => makeImageSuccess());
    vi.stubGlobal('fetch', fetchMock);

    const promise = callGeminiImage({ prompt: 'a test graphic' });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives up immediately when the DAY budget is spent', async () => {
    // The daily quota does not reset inside any wait we could survive, so
    // sleeping out the ceiling first would only waste a worker slot.
    redisEval.mockResolvedValue([0, 4_000_000, 1, 240]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const promise = callGeminiImage({ prompt: 'a test graphic' });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.RATE_LIMITED);
    expect(fetchMock).not.toHaveBeenCalled();
    // One reservation attempt, no retry loop.
    expect(redisEval).toHaveBeenCalledTimes(1);
  });

  it('honours a job-scoped budget that is tighter than the per-request ceiling', async () => {
    // A carousel fans out into several requests; without a shared job budget
    // each could wait the full per-request ceiling and the job as a whole
    // would outlive the queue lock that protects it from being re-run.
    redisEval.mockResolvedValue([0, 60_000, 0, 3]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const promise = runWithGeminiImageAdmissionBudget(1_000, () =>
      callGeminiImage({ prompt: 'a test graphic' })
    );
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(false);
    // Refused on the first reservation: a 60s sleep does not fit in 1s.
    expect(redisEval).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('jitters the wait so refused waiters do not all wake together', async () => {
    // With the jitter maxed out the advised 60s wait becomes 63s, which no
    // longer fits a 61s budget. Without jitter this request would have slept
    // and retried — proving the jitter is really added to the wait.
    redisEval.mockResolvedValue([0, 60_000, 0, 3]);
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const promise = runWithGeminiImageAdmissionBudget(61_000, () =>
      callGeminiImage({ prompt: 'a test graphic' })
    );
    await vi.runAllTimersAsync();
    await promise;

    expect(redisEval).toHaveBeenCalledTimes(1);
    vi.mocked(Math.random).mockRestore();
  });
});
