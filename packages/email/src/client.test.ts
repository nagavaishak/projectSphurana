import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.fn();

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

vi.mock('@borradh-workspace/env/email', () => ({
  emailEnv: { RESEND_API_KEY: 'test-key' },
}));

// A JS-equivalent of the sliding-window Lua script, so this test exercises
// the real polling/wait behavior of `sendResendEmail` without needing a live
// Redis. `store` is shared across every `getRedis()` call in a test the same
// way one real Redis instance is shared across replicas.
const { mockEval, resetRateLimitStore } = vi.hoisted(() => {
  const store = new Map<string, Map<string, number>>();
  const mockEval = vi.fn(
    async (
      _script: string,
      _numkeys: number,
      key: string,
      now: number,
      window: number,
      limit: number,
      member: string
    ) => {
      let zset = store.get(key);
      if (!zset) {
        zset = new Map();
        store.set(key, zset);
      }
      for (const [m, score] of zset) {
        if (score <= now - window) zset.delete(m);
      }
      if (zset.size < limit) {
        zset.set(member, now);
        return 1;
      }
      return 0;
    }
  );
  return { mockEval, resetRateLimitStore: () => store.clear() };
});

vi.mock('@borradh-workspace/redis', () => ({
  getRedis: () => ({ eval: mockEval }),
}));

describe('sendResendEmail', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    mockSend.mockResolvedValue({ data: { id: 'msg_1' }, error: null });
    mockEval.mockClear();
    resetRateLimitStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throttles a burst so not every call reaches Resend immediately, then eventually sends them all', async () => {
    const { sendResendEmail } = await import('./client.js');
    const payload = {
      from: 'a@b.com',
      to: ['c@d.com'],
      subject: 'x',
      html: '<p>x</p>',
    };

    // Resend's real cap is 10/s — fire well past that in one burst.
    const calls = Array.from({ length: 12 }, () => sendResendEmail(payload));

    // Give the microtask queue a beat: unthrottled sends resolve almost
    // immediately, throttled ones are still waiting on a timer.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const immediateCount = mockSend.mock.calls.length;

    await Promise.all(calls);

    expect(mockSend).toHaveBeenCalledTimes(12);
    // The whole burst did NOT go out unthrottled — this is the bug being
    // fixed (concurrency/limiter mismatch let bursts blow past Resend's cap).
    expect(immediateCount).toBeLessThan(12);
  }, 10_000);

  it('shares the budget across concurrent "replicas" — two independent callers still can\'t exceed the combined cap', async () => {
    const { sendResendEmail } = await import('./client.js');
    const payload = {
      from: 'a@b.com',
      to: ['c@d.com'],
      subject: 'x',
      html: '<p>x</p>',
    };

    // Simulate two processes racing for the same shared Redis budget —
    // this is exactly the scenario the in-process-only version couldn't
    // handle (each replica would have granted its own 9/s independently).
    const replicaA = Array.from({ length: 6 }, () => sendResendEmail(payload));
    const replicaB = Array.from({ length: 6 }, () => sendResendEmail(payload));

    await new Promise((resolve) => setTimeout(resolve, 20));
    const immediateCount = mockSend.mock.calls.length;

    await Promise.all([...replicaA, ...replicaB]);

    expect(mockSend).toHaveBeenCalledTimes(12);
    // Combined, the two "replicas" still respect the single shared cap.
    expect(immediateCount).toBeLessThanOrEqual(9);
  }, 10_000);

  it('propagates the Resend client error unchanged on failure', async () => {
    mockSend.mockResolvedValueOnce({
      data: null,
      error: { name: 'rate_limit_exceeded', message: 'Too many requests.' },
    });
    const { sendResendEmail } = await import('./client.js');

    const { error } = await sendResendEmail({
      from: 'a@b.com',
      to: ['c@d.com'],
      subject: 'x',
      html: '<p>x</p>',
    });

    expect(error).toEqual({
      name: 'rate_limit_exceeded',
      message: 'Too many requests.',
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('reproduces and recovers from Resend processing failures without duplicate sends', async () => {
    // This is the exact provider response behind Sentry API-F8. It is a
    // transient Resend 5xx, not an invalid appointment or recipient.
    mockSend
      .mockResolvedValueOnce({
        data: null,
        error: {
          name: 'application_error',
          message: 'Failed to process email sending',
        },
      })
      .mockResolvedValueOnce({ data: { id: 'msg_recovered' }, error: null });
    const { sendResendEmail } = await import('./client.js');

    const result = await sendResendEmail({
      from: 'a@b.com',
      to: ['c@d.com'],
      subject: 'x',
      html: '<p>x</p>',
    });

    expect(result).toEqual({ data: { id: 'msg_recovered' }, error: null });
    expect(mockSend).toHaveBeenCalledTimes(2);
    const firstIdempotencyKey = mockSend.mock.calls[0][1]?.idempotencyKey;
    expect(firstIdempotencyKey).toEqual(
      mockSend.mock.calls[1][1]?.idempotencyKey
    );
    expect(firstIdempotencyKey).toEqual(expect.any(String));
  });

  it('returns a Resend processing error after bounded retries', async () => {
    mockSend.mockResolvedValue({
      data: null,
      error: {
        name: 'internal_server_error',
        message: 'Failed to process email sending',
      },
    });
    const { sendResendEmail } = await import('./client.js');

    const { error } = await sendResendEmail({
      from: 'a@b.com',
      to: ['c@d.com'],
      subject: 'x',
      html: '<p>x</p>',
    });

    expect(error).toEqual({
      name: 'internal_server_error',
      message: 'Failed to process email sending',
    });
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it('times out with a retryable-shaped error instead of hanging forever when the budget stays saturated', async () => {
    // Every claim attempt is denied — simulates a caller stuck behind a
    // sustained burst from elsewhere sharing this Redis budget (e.g. a
    // different PR preview's bulk campaign). A synchronous caller (like
    // sign-up's awaited verification email) must not hang past this.
    mockEval.mockImplementation(async () => 0);
    const { sendResendEmail } = await import('./client.js');
    const { ResendSendError } = await import('./errors.js');

    vi.useFakeTimers();
    const promise = sendResendEmail({
      from: 'a@b.com',
      to: ['c@d.com'],
      subject: 'x',
      html: '<p>x</p>',
    });
    const assertion = expect(promise).rejects.toMatchObject({
      code: 'client_rate_limit_timeout',
    });
    const instanceAssertion =
      expect(promise).rejects.toBeInstanceOf(ResendSendError);
    await vi.advanceTimersByTimeAsync(20_000);
    await Promise.all([assertion, instanceAssertion]);

    expect(mockSend).not.toHaveBeenCalled();
  }, 10_000);
});
