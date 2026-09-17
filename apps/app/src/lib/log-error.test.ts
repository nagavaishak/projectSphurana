// Locks the invariant that both frontend reporting helpers reach PostHog as
// well as Sentry. `logWarning` shipped Sentry-only for ~2 months, which made
// warning-level issues (e.g. `upload.analysisTimeout`) invisible in PostHog.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const captureException = vi.fn();
const captureMessage = vi.fn();
const scope = {
  setTag: vi.fn(),
  setExtras: vi.fn(),
};

vi.mock('@sentry/react', () => ({
  captureException: (...a: unknown[]) => captureException(...a),
  captureMessage: (...a: unknown[]) => captureMessage(...a),
  withScope: (cb: (s: unknown) => void) => cb(scope),
}));

const phCaptureException = vi.fn();
const optedOut = { value: false };
vi.mock('posthog-js', () => ({
  default: {
    __loaded: true,
    captureException: (...a: unknown[]) => phCaptureException(...a),
    has_opted_out_capturing: () => optedOut.value,
    opt_in_capturing: vi.fn(() => {
      optedOut.value = false;
    }),
    opt_out_capturing: vi.fn(() => {
      optedOut.value = true;
    }),
  },
}));

const { logError, logWarning, reportUnhandledToPostHog } = await import(
  './log-error'
);

describe('frontend reporting paths dual-send', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    optedOut.value = false;
  });

  it('logError sends to both', () => {
    logError('billing.checkout', new Error('boom'), { feature: 'billing' });

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(phCaptureException).toHaveBeenCalledTimes(1);
  });

  it('logWarning sends to both — REGRESSION GUARD, was Sentry-only', () => {
    logWarning('upload.analysisTimeout', 'Asset analysis timed out');

    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(phCaptureException).toHaveBeenCalledTimes(1);
  });

  it('logWarning tags the PostHog event warning-level, logError does not', () => {
    logWarning('upload.analysisTimeout', 'Asset analysis timed out', {
      feature: 'upload',
      extra: { assetId: 'a1' },
    });

    const [error, properties] = phCaptureException.mock.calls[0] as [
      Error,
      Record<string, unknown>,
    ];
    expect(error.message).toBe('Asset analysis timed out');
    expect(properties.$exception_level).toBe('warning');
    expect(properties.operation).toBe('upload.analysisTimeout');
    expect(properties.feature).toBe('upload');
    expect(properties.assetId).toBe('a1');

    vi.clearAllMocks();
    logError('billing.checkout', new Error('boom'));
    const [, errProps] = phCaptureException.mock.calls[0] as [
      Error,
      Record<string, unknown>,
    ];
    expect(errProps.$exception_level).toBe('error');
  });

  it('logWarning captures for DNT-opted-out users, then restores opt-out', () => {
    // Same policy as logError: reliability reporting is not analytics, so an
    // opted-out user's errors/warnings still reach PostHog. The opt-out state
    // must be restored afterwards or we'd silently re-enable analytics capture.
    optedOut.value = true;

    logWarning('upload.analysisTimeout', 'Asset analysis timed out');

    expect(phCaptureException).toHaveBeenCalledTimes(1);
    expect(optedOut.value).toBe(true);
  });

  it('logWarning records whether PostHog was loaded, for gap diagnosis', () => {
    // If `posthog_loaded=false` shows up on warnings in Sentry, the PostHog copy
    // was dropped pre-init — the known cause of the WEB-15/WEB-29 class of
    // Sentry-only issues. Without this tag a warning-shaped gap is invisible.
    logWarning('upload.analysisTimeout', 'Asset analysis timed out');

    expect(scope.setTag).not.toHaveBeenCalled(); // logWarning uses tags option
    const [, options] = captureMessage.mock.calls[0] as [
      string,
      { tags: Record<string, string> },
    ];
    expect(options.tags.posthog_loaded).toBe('true');
  });
});

// ENG-853: reportUnhandledToPostHog used to re-wrap every raw value as
// `new Error(String(error))`, which discarded the original stack (and any
// origin frames on it) and gave every unhandled error an identical,
// call-site-pointing stack — collapsing unrelated errors into one PostHog
// issue. These lock the fix: the raw value reaches posthog-js unwrapped, and
// values the SDK can only coerce synthetically get an explicit fingerprint so
// they don't collide with each other under that shared synthetic stack.
describe('reportUnhandledToPostHog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rebuilds a cross-realm error-like object as a same-realm Error that keeps its own stack', () => {
    // A cross-realm error (e.g. Safari autofill/password-manager) is NOT
    // `instanceof Error` in our realm, but still carries its own name/message
    // /stack. posthog-js only reads the stack of a same-realm Error; anything
    // else goes through its generic object coercer, which rewrites the value
    // to `'Error' captured as exception with message: '…'` and substitutes the
    // SDK's synthetic stack — defeating both the anchored message rules and
    // the extension-origin filter in classifyDroppableEvent (verified in a
    // real browser, 2026-09-02). So it is rebuilt, not passed through.
    const crossRealmError = {
      name: 'TypeError',
      message: 'Failed to get inline suggestions',
      stack:
        'TypeError: Failed to get inline suggestions\n    at run (safari-web-extension://abc/content.js:1:1)',
    };

    reportUnhandledToPostHog(crossRealmError, 'unhandledrejection');

    expect(phCaptureException).toHaveBeenCalledTimes(1);
    const [passed, props] = phCaptureException.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(passed).toBeInstanceOf(Error);
    expect(passed).not.toBe(crossRealmError);
    expect((passed as Error).name).toBe('TypeError');
    expect((passed as Error).message).toBe('Failed to get inline suggestions');
    expect((passed as Error).stack).toBe(crossRealmError.stack);
    // Real frames now drive grouping — no message fingerprint override.
    expect(props.$exception_fingerprint).toBeUndefined();
  });

  it('fingerprints a non-error-like object (no message) instead of rebuilding it', () => {
    reportUnhandledToPostHog({ code: 42 }, 'unhandledrejection');

    const [passed, props] = phCaptureException.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(passed).toEqual({ code: 42 });
    expect(props.$exception_fingerprint).toBe(
      'unhandled:unhandledrejection:[object Object]'
    );
  });

  it('fingerprints a non-Error value so distinct messages do not collide', () => {
    reportUnhandledToPostHog('just a string', 'window.onerror');

    const [, props] = phCaptureException.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    // PostHog documents $exception_fingerprint as a plain string, not an
    // array (https://posthog.com/docs/error-tracking/capture#customizing-exception-capture).
    expect(props.$exception_fingerprint).toBe(
      'unhandled:window.onerror:just a string'
    );
  });

  it('does not fingerprint a real Error — its own stack differentiates it', () => {
    reportUnhandledToPostHog(new Error('real error'), 'window.onerror');

    const [passed, props] = phCaptureException.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(passed).toBeInstanceOf(Error);
    expect(props.$exception_fingerprint).toBeUndefined();
  });

  it('no longer sends the dead $exception_handled extra', () => {
    reportUnhandledToPostHog(new Error('real error'), 'window.onerror');

    const [, props] = phCaptureException.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(props.$exception_handled).toBeUndefined();
  });

  it('tags the event feature:unhandled, which before_send uses to fix the handled flag', () => {
    reportUnhandledToPostHog(new Error('real error'), 'unhandledrejection');

    const [, props] = phCaptureException.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(props.feature).toBe('unhandled');
    expect(props.operation).toBe('unhandledrejection');
  });
});
