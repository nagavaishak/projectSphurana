// The mirror's window OVERLAPS its schedule on purpose, so the SAME event is
// seen on consecutive runs. That makes the claim the load-bearing part: without
// it, overlap duplicates every crash on every run — worse than the gap it exists
// to prevent. Most of these tests are about that.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = {
  SENTRY_AUTH_TOKEN: 'tok' as string | undefined,
  SENTRY_ORG: 'borradh-production',
  SENTRY_MOBILE_PROJECT: 'web',
};
vi.mock('@borradh-workspace/env/observability', () => ({
  get observabilityEnv() {
    return env;
  },
}));

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};
vi.mock('../logger.js', () => ({ getLogger: () => logger }));

const capturePostHogException = vi.fn();
const deployEnvironment = { value: 'production' };
vi.mock('../posthog/client.js', () => ({
  capturePostHogException: (...a: unknown[]) => capturePostHogException(...a),
  getDeployEnvironment: () => deployEnvironment.value,
}));

const { mirrorSentryNativeEvents } = await import('./mirror.js');

const nativeEvent = (id: string) => ({
  eventID: id,
  sdk: { name: 'sentry.cocoa' },
  platform: 'cocoa',
  title: 'App Hang',
  metadata: { type: 'App Hang', value: 'hung' },
});

const jsEvent = (id: string) => ({
  eventID: id,
  sdk: { name: 'sentry.javascript.capacitor' },
  platform: 'javascript',
  title: 'TypeError',
});

const respondWith = (events: unknown[]) =>
  vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(events),
    } as unknown as Response)
  );

/** A claim store that behaves like Redis SET NX. */
const claimStore = () => {
  const seen = new Set<string>();
  return {
    seen,
    claimEvent: vi.fn(async (id: string) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    }),
  };
};

describe('mirrorSentryNativeEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env.SENTRY_AUTH_TOKEN = 'tok';
    deployEnvironment.value = 'production';
  });

  it.each(['preview', 'staging', 'development'])(
    'refuses to mirror from %s — exactly one environment may own this',
    async (environment) => {
      // Every environment has its OWN Redis, so claims are not shared between
      // them. Without this gate the prod API, staging and every PR preview would
      // each forward the same production crash, multiplying it in PostHog.
      deployEnvironment.value = environment;
      const store = claimStore();

      const result = await mirrorSentryNativeEvents({
        claimEvent: store.claimEvent,
        fetchImpl: respondWith([nativeEvent('n1')]),
      });

      expect(result.skipped).toBe('not-production');
      expect(capturePostHogException).not.toHaveBeenCalled();
      expect(store.claimEvent).not.toHaveBeenCalled();
    }
  );

  it('forwards native events and ignores JS ones', async () => {
    const store = claimStore();
    const result = await mirrorSentryNativeEvents({
      claimEvent: store.claimEvent,
      fetchImpl: respondWith([nativeEvent('n1'), jsEvent('j1')]),
    });

    expect(result).toMatchObject({ scanned: 2, native: 1, forwarded: 1 });
    expect(capturePostHogException).toHaveBeenCalledTimes(1);
    const [, , properties] = capturePostHogException.mock.calls[0] as [
      Error,
      undefined,
      Record<string, unknown>,
    ];
    expect(properties.sentry_event_id).toBe('n1');
  });

  it('does NOT re-forward on an overlapping second run', async () => {
    // The duplicate-every-crash case the claim exists to prevent.
    const store = claimStore();
    const events = [nativeEvent('n1'), nativeEvent('n2')];

    const first = await mirrorSentryNativeEvents({
      claimEvent: store.claimEvent,
      fetchImpl: respondWith(events),
    });
    expect(first.forwarded).toBe(2);

    capturePostHogException.mockClear();
    const second = await mirrorSentryNativeEvents({
      claimEvent: store.claimEvent,
      fetchImpl: respondWith(events),
    });

    expect(second).toMatchObject({ forwarded: 0, skippedAlreadyClaimed: 2 });
    expect(capturePostHogException).not.toHaveBeenCalled();
  });

  it('does NOT forward when the claim store throws', async () => {
    // Forwarding unclaimed would duplicate on the next overlapping run, so an
    // unavailable claim store must mean "skip", never "send anyway".
    const result = await mirrorSentryNativeEvents({
      claimEvent: vi.fn(() => Promise.reject(new Error('redis down'))),
      fetchImpl: respondWith([nativeEvent('n1')]),
    });

    expect(result.forwarded).toBe(0);
    expect(capturePostHogException).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it('skips an event with no id rather than forwarding unclaimably', async () => {
    const store = claimStore();
    const result = await mirrorSentryNativeEvents({
      claimEvent: store.claimEvent,
      fetchImpl: respondWith([
        { sdk: { name: 'sentry.cocoa' }, title: 'no id here' },
      ]),
    });

    expect(result).toMatchObject({ native: 1, forwarded: 0 });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('no-ops without a token instead of throwing', async () => {
    env.SENTRY_AUTH_TOKEN = undefined;
    const store = claimStore();

    const result = await mirrorSentryNativeEvents({
      claimEvent: store.claimEvent,
      fetchImpl: respondWith([nativeEvent('n1')]),
    });

    expect(result.skipped).toBe('no-token');
    expect(capturePostHogException).not.toHaveBeenCalled();
  });

  it('survives a Sentry API error without throwing', async () => {
    // Runs on a scheduler tick beside real work; a Sentry hiccup must not take
    // the tick down.
    const store = claimStore();
    const result = await mirrorSentryNativeEvents({
      claimEvent: store.claimEvent,
      fetchImpl: vi.fn(() =>
        Promise.resolve({ ok: false, status: 503 } as unknown as Response)
      ),
    });

    expect(result.forwarded).toBe(0);
    expect(logger.error).toHaveBeenCalled();
  });

  it('survives a rejected fetch and a non-array payload', async () => {
    const store = claimStore();

    await expect(
      mirrorSentryNativeEvents({
        claimEvent: store.claimEvent,
        fetchImpl: vi.fn(() => Promise.reject(new Error('network'))),
      })
    ).resolves.toMatchObject({ forwarded: 0 });

    await expect(
      mirrorSentryNativeEvents({
        claimEvent: store.claimEvent,
        fetchImpl: vi.fn(() =>
          Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ detail: 'nope' }),
          } as unknown as Response)
        ),
      })
    ).resolves.toMatchObject({ forwarded: 0 });
  });

  it('queries a window that OVERLAPS the schedule', async () => {
    const fetchImpl = respondWith([]);
    const store = claimStore();
    const now = new Date('2026-08-17T12:00:00.000Z');

    await mirrorSentryNativeEvents(
      { claimEvent: store.claimEvent, fetchImpl, now: () => now },
      { lookbackMinutes: 120 }
    );

    const url = String((fetchImpl.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('/projects/borradh-production/web/events/');
    // 120 minutes back from 12:00 — comfortably wider than the 15-minute
    // schedule, so a skipped run cannot open a permanent hole.
    expect(url).toContain(encodeURIComponent('2026-08-17T10:00:00.000Z'));
  });
});
