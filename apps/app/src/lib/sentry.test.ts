// `apps/app` is ONE codebase serving the browser and the iOS/Android Capacitor
// shells from one DSN into one Sentry project. The platform branch in initSentry
// is therefore the only place "Sentry on mobile but not web" can exist, and the
// asymmetry it encodes is load-bearing:
//
//   - native MUST always initialise — PostHog on mobile is posthog-js in a
//     WebView and cannot see native crashes or ANRs, so Sentry is permanent
//     there and no flag may turn it off.
//   - web is gated, defaulting to ON, so the cutover is an env flip and the
//     rollback is just as fast.
//
// Both halves are silent when wrong, which is why they are pinned here.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sentryInit = vi.fn();
vi.mock('@sentry/capacitor', () => ({
  init: (...a: unknown[]) => sentryInit(...a),
}));

vi.mock('@sentry/react', () => ({
  init: vi.fn(),
  browserTracingIntegration: () => ({ name: 'BrowserTracing' }),
}));

const platform = { value: 'web' };
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => platform.value,
  },
}));

type Config = Parameters<typeof import('./sentry').initSentry>[0];

const config = (overrides: Partial<Config> = {}): Config =>
  ({
    sentryDsn: 'https://examplePublicKey@o0.ingest.sentry.io/0',
    appEnv: 'production',
    sentryWebDisabled: false,
    ...overrides,
  }) as Config;

/** initSentry latches via a module-level flag, so each case needs a fresh copy. */
const freshInit = async () => {
  vi.resetModules();
  const mod = await import('./sentry');
  return mod.initSentry;
};

describe('initSentry platform branch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platform.value = 'web';
  });

  it('web: initialises by default', () => {
    // The default must be Sentry ON — the flag is opt-in.
    return freshInit().then((initSentry) => {
      initSentry(config());
      expect(sentryInit).toHaveBeenCalledTimes(1);
    });
  });

  it('web: skips when SENTRY_WEB_DISABLED is set', async () => {
    const initSentry = await freshInit();
    initSentry(config({ sentryWebDisabled: true }));

    expect(sentryInit).not.toHaveBeenCalled();
  });

  it('ios: initialises EVEN when the web flag is set', async () => {
    // The flag must not be able to disable native. PostHog cannot replace it.
    platform.value = 'ios';
    const initSentry = await freshInit();
    initSentry(config({ sentryWebDisabled: true }));

    expect(sentryInit).toHaveBeenCalledTimes(1);
  });

  it('android: initialises EVEN when the web flag is set', async () => {
    platform.value = 'android';
    const initSentry = await freshInit();
    initSentry(config({ sentryWebDisabled: true }));

    expect(sentryInit).toHaveBeenCalledTimes(1);
  });

  it('no DSN: skips on every platform', async () => {
    for (const p of ['web', 'ios', 'android']) {
      platform.value = p;
      const initSentry = await freshInit();
      vi.clearAllMocks();
      initSentry(config({ sentryDsn: null }));
      expect(sentryInit).not.toHaveBeenCalled();
    }
  });

  it('web disabled: does not re-enter on a second call', async () => {
    const initSentry = await freshInit();
    initSentry(config({ sentryWebDisabled: true }));
    initSentry(config({ sentryWebDisabled: true }));

    expect(sentryInit).not.toHaveBeenCalled();
  });

  it('tunnel is only set on web, so native keeps the native transport', async () => {
    const initSentry = await freshInit();
    initSentry(config());
    expect(sentryInit.mock.calls[0][0]).toMatchObject({
      tunnel: '/api/monitoring',
    });

    platform.value = 'ios';
    const nativeInit = await freshInit();
    vi.clearAllMocks();
    nativeInit(config());
    expect(sentryInit.mock.calls[0][0].tunnel).toBeUndefined();
  });
});
