// The WEB-15 / WEB-29 class: unhandled errors that reached Sentry and never
// reached PostHog, because posthog-js arms its autocapture from a lazily-fetched
// script while Sentry installs its handlers synchronously. These lock the two
// halves of the fix — synchronous listeners, and a buffer for the boot window.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const phCaptureException = vi.fn();
const loaded = { value: false };

vi.mock('posthog-js', () => ({
  default: {
    get __loaded() {
      return loaded.value;
    },
    captureException: (...a: unknown[]) => phCaptureException(...a),
    has_opted_out_capturing: () => false,
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
  },
}));

const sentryCapture = vi.fn();
vi.mock('@sentry/react', () => ({
  captureException: (...a: unknown[]) => sentryCapture(...a),
  captureMessage: vi.fn(),
  withScope: (cb: (s: unknown) => void) =>
    cb({ setTag: vi.fn(), setExtras: vi.fn() }),
}));

const { installGlobalErrorHandlers } = await import('./global-error-handlers');
const { flushPostHogErrorQueue } = await import('./log-error');

// Installed once at module scope, mirroring main.tsx: the listeners must be live
// before anything else runs.
installGlobalErrorHandlers();

const fireError = (error: unknown) => {
  const event = new Event('error') as ErrorEvent;
  Object.defineProperty(event, 'error', { value: error });
  Object.defineProperty(event, 'message', { value: 'boom message' });
  window.dispatchEvent(event);
};

const fireRejection = (reason: unknown) => {
  const event = new Event('unhandledrejection') as PromiseRejectionEvent;
  Object.defineProperty(event, 'reason', { value: reason });
  window.dispatchEvent(event);
};

describe('global error handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loaded.value = true;
    flushPostHogErrorQueue();
    vi.clearAllMocks();
  });

  it('reports an unhandled error to PostHog', () => {
    fireError(new Error('kaboom'));

    expect(phCaptureException).toHaveBeenCalledTimes(1);
    const [err, props] = phCaptureException.mock.calls[0] as [
      Error,
      Record<string, unknown>,
    ];
    expect(err.message).toBe('kaboom');
    expect(props.feature).toBe('unhandled');
    expect(props.operation).toBe('window.onerror');
  });

  it('reports an unhandled promise rejection', () => {
    fireRejection(new Error('rejected'));

    expect(phCaptureException).toHaveBeenCalledTimes(1);
    const [, props] = phCaptureException.mock.calls[0] as [
      Error,
      Record<string, unknown>,
    ];
    expect(props.operation).toBe('unhandledrejection');
  });

  it('does NOT also report to Sentry', () => {
    // Sentry's own global handlers already capture these. A second report from
    // here would duplicate every unhandled error into its own extra issue.
    fireError(new Error('kaboom'));
    fireRejection(new Error('rejected'));

    expect(sentryCapture).not.toHaveBeenCalled();
  });

  it('falls back to the message for cross-origin "Script error." events', () => {
    // `event.error` is null for cross-origin scripts; without the fallback the
    // event would be dropped entirely. The fallback is a plain string, so it
    // is passed through unwrapped (not instanceof Error) with a fingerprint.
    fireError(null);

    expect(phCaptureException).toHaveBeenCalledTimes(1);
    const [passed, props] = phCaptureException.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(passed).toBe('boom message');
    expect(props.$exception_fingerprint).toBe(
      'unhandled:window.onerror:boom message'
    );
  });

  it('ENG-853: passes a non-Error rejection reason through unwrapped, fingerprinted', () => {
    // Used to be re-wrapped as `new Error('just a string')`, which discarded
    // the raw value and gave it a stack pointing at our own wrapper — see
    // reportUnhandledToPostHog's doc comment. It must now reach posthog-js
    // as-is, with a fingerprint so it doesn't collide with other synthesized
    // exceptions under the SDK's shared synthetic stack.
    fireRejection('just a string');

    const [passed, props] = phCaptureException.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(passed).toBe('just a string');
    expect(props.$exception_fingerprint).toBe(
      'unhandled:unhandledrejection:just a string'
    );
  });
});

describe('pre-init buffering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loaded.value = true;
    flushPostHogErrorQueue();
    vi.clearAllMocks();
  });

  it('buffers while posthog is not loaded, then replays on flush', () => {
    // This is the WEB-15 window: Sentry is up, posthog-js is not yet.
    loaded.value = false;
    fireError(new Error('during boot'));
    expect(phCaptureException).not.toHaveBeenCalled();

    loaded.value = true;
    flushPostHogErrorQueue();

    expect(phCaptureException).toHaveBeenCalledTimes(1);
    const [err] = phCaptureException.mock.calls[0] as [Error];
    expect(err.message).toBe('during boot');
  });

  it('flushing twice does not re-send', () => {
    loaded.value = false;
    fireError(new Error('during boot'));
    loaded.value = true;

    flushPostHogErrorQueue();
    flushPostHogErrorQueue();

    expect(phCaptureException).toHaveBeenCalledTimes(1);
  });

  it('is bounded, so an error loop cannot grow without limit', () => {
    loaded.value = false;
    for (let i = 0; i < 200; i += 1) fireError(new Error(`boot ${i}`));
    loaded.value = true;

    flushPostHogErrorQueue();

    // Capped at 50, and it keeps the EARLIEST — the boot errors this exists for.
    expect(phCaptureException).toHaveBeenCalledTimes(50);
    const [first] = phCaptureException.mock.calls[0] as [Error];
    expect(first.message).toBe('boot 0');
  });

  it('flush is a no-op when posthog never loads', () => {
    loaded.value = false;
    fireError(new Error('during boot'));

    expect(() => flushPostHogErrorQueue()).not.toThrow();
    expect(phCaptureException).not.toHaveBeenCalled();
  });
});
