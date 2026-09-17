// Locks the invariant that EVERY error/warning reporting path sends to PostHog
// as well as Sentry.
//
// This exists because `logWarning` shipped Sentry-only for ~2 months and nobody
// noticed: warning-level issues simply did not exist in PostHog (4 issues / 11
// prod events over 30 days, all invisible). A one-off probe would not have
// caught it either, since nothing was obviously broken — only a comparison
// against Sentry revealed the hole. So the guard is a test, not a probe: adding
// a new reporting helper that forgets PostHog now fails here.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sentryCaptureException = vi.fn();
const sentryCaptureMessage = vi.fn();
const withScope = vi.fn((cb: (scope: unknown) => void) =>
  cb({
    setTag: vi.fn(),
    setTags: vi.fn(),
    setExtras: vi.fn(),
    setUser: vi.fn(),
  })
);

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: (...a: unknown[]) => sentryCaptureException(...a),
  captureMessage: (...a: unknown[]) => sentryCaptureMessage(...a),
  withScope: (cb: (scope: unknown) => void) => withScope(cb),
}));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('../logger.js', () => ({ getLogger: () => logger }));

const capturePostHogException = vi.fn();
vi.mock('../posthog/client.js', () => ({
  capturePostHogException: (...a: unknown[]) => capturePostHogException(...a),
}));

vi.mock('../context.js', () => ({
  getCurrentUserId: () => 'user-from-context',
  getCurrentRequestProps: () => ({}),
}));

const forwardErrorToBetterStack = vi.fn();
vi.mock('./betterstack-forwarder.js', () => ({
  forwardEventToBetterStack: vi.fn(),
  forwardErrorToBetterStack: (...a: unknown[]) =>
    forwardErrorToBetterStack(...a),
}));

const { logError, logWarning, initSentry } = await import('./client.js');

// Sentry must be live, otherwise the Sentry half no-ops and the test proves
// nothing about the two halves running together.
initSentry({ dsn: 'https://examplePublicKey@o0.ingest.sentry.io/0' });

describe('reporting paths dual-send to PostHog and Sentry', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logError sends to both', () => {
    logError('billing.checkout', new Error('boom'), {
      feature: 'billing',
      extra: { planId: 'pro' },
    });

    expect(capturePostHogException).toHaveBeenCalledTimes(1);
    expect(sentryCaptureException).toHaveBeenCalledTimes(1);
  });

  it('logWarning sends to both — REGRESSION GUARD, was Sentry-only', () => {
    logWarning('upload.analysisTimeout', 'Asset analysis timed out', {
      feature: 'upload',
      extra: { assetId: 'a1' },
    });

    expect(sentryCaptureMessage).toHaveBeenCalledTimes(1);
    expect(capturePostHogException).toHaveBeenCalledTimes(1);
  });

  it('logWarning marks the PostHog event as warning-level, not error', () => {
    logWarning('upload.analysisTimeout', 'Asset analysis timed out');

    const [error, distinctId, properties] = capturePostHogException.mock
      .calls[0] as [Error, string, Record<string, unknown>];

    // Sent as an $exception (PostHog has no "message" concept) but tagged so
    // error-only dashboards and alerts can exclude it.
    expect(properties.$exception_level).toBe('warning');
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Asset analysis timed out');
    expect(properties.operation).toBe('upload.analysisTimeout');
    // Feature is derived from the operation prefix when not given explicitly.
    expect(properties.feature).toBe('upload');
    expect(distinctId).toBe('user-from-context');
  });

  it('logWarning reaches PostHog even when Sentry is not initialized', async () => {
    // The two sinks must fail independently: the PostHog send sits OUTSIDE the
    // `if (isInitialized)` guard on purpose, so a missing/broken Sentry DSN
    // cannot also take PostHog reporting down with it.
    vi.resetModules();
    const fresh = await import('./client.js');
    vi.clearAllMocks();

    fresh.logWarning('upload.analysisTimeout', 'no sentry here');

    expect(sentryCaptureMessage).not.toHaveBeenCalled();
    expect(capturePostHogException).toHaveBeenCalledTimes(1);
  });
});

describe('logError groups PostHog exceptions on the app stack (ENG-851)', () => {
  beforeEach(() => vi.clearAllMocks());

  // A stack shaped like the real deployed bundle: an apps/api frame with no
  // node_modules segment, so the SDK's raw filenameIsInApp check already
  // marks it in_app without needing the before_send hook.
  const APPS_API_LINE =
    '    at LeadsController.create (/app/apps/api/dist/leads/leads.controller.js:18:23)';
  // A stack with no app frame anywhere — every line is a node internal.
  const NODE_INTERNAL_LINE =
    '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)';

  it('captures the TOP-LEVEL error to PostHog, not the cause — the cause stays reachable via .cause', () => {
    const pgError = new Error('duplicate key value violates unique constraint');
    pgError.name = 'PostgresError';
    pgError.stack = `PostgresError: duplicate key value violates unique constraint\n${NODE_INTERNAL_LINE}`;
    (pgError as unknown as { code: string }).code = '23505';

    const wrapper = new Error('Failed to create practitioner', {
      cause: pgError,
    });
    wrapper.name = 'FeatureError';
    wrapper.stack = `FeatureError: Failed to create practitioner\n${APPS_API_LINE}`;

    logError('practitioners.createPractitioner', wrapper, {
      feature: 'practitioners',
    });

    expect(capturePostHogException).toHaveBeenCalledTimes(1);
    const [capturedError] = capturePostHogException.mock.calls[0] as [Error];

    // The TOP-LEVEL wrapper is what PostHog receives...
    expect(capturedError).toBe(wrapper);
    expect(capturedError.message).toBe('Failed to create practitioner');
    // ...but the cause is still reachable — posthog-node's captureException
    // serializes .cause into $exception_list[1..], so nothing is lost.
    expect(capturedError.cause).toBe(pgError);
    expect((capturedError.cause as Error).name).toBe('PostgresError');
  });

  it('does NOT set $exception_fingerprint when the wrapper has an in-app frame', () => {
    const pgError = new Error('duplicate key value violates unique constraint');
    pgError.name = 'PostgresError';
    pgError.stack = `PostgresError: duplicate key\n${NODE_INTERNAL_LINE}`;
    (pgError as unknown as { code: string }).code = '23505';

    const wrapper = new Error('Failed to create practitioner', {
      cause: pgError,
    });
    wrapper.name = 'FeatureError';
    wrapper.stack = `FeatureError: Failed to create practitioner\n${APPS_API_LINE}`;

    logError('practitioners.createPractitioner', wrapper);

    const [, , properties] = capturePostHogException.mock.calls[0] as [
      Error,
      string,
      Record<string, unknown>,
    ];
    expect(properties.$exception_fingerprint).toBeUndefined();
  });

  it('sets a stable $exception_fingerprint when NEITHER the wrapper nor its cause has an in-app frame', () => {
    const pgError = new Error('duplicate key value violates unique constraint');
    pgError.name = 'PostgresError';
    pgError.stack = `PostgresError: duplicate key\n${NODE_INTERNAL_LINE}`;
    (pgError as unknown as { code: string }).code = '23505';

    const wrapper = new Error('Failed to create practitioner', {
      cause: pgError,
    });
    wrapper.name = 'FeatureError';
    // No apps/packages frame anywhere — e.g. thrown from a path this repo
    // doesn't own any in-app frame for.
    wrapper.stack = `FeatureError: Failed to create practitioner\n${NODE_INTERNAL_LINE}`;

    logError('http.unhandled5xx', wrapper);

    const [, , properties] = capturePostHogException.mock.calls[0] as [
      Error,
      string,
      Record<string, unknown>,
    ];
    // operation:errorName:code — built from the pg code the existing pgFields
    // extraction already found on the cause.
    expect(properties.$exception_fingerprint).toBe(
      'http.unhandled5xx:FeatureError:23505'
    );
  });

  it('falls back to the cause name when there is no pg/stripe code, still without an in-app frame', () => {
    const cause = new Error('some internal driver failure');
    cause.name = 'InternalDriverError';
    cause.stack = `InternalDriverError: some internal driver failure\n${NODE_INTERNAL_LINE}`;

    const wrapper = new Error('operation failed', { cause });
    wrapper.name = 'FeatureError';
    wrapper.stack = `FeatureError: operation failed\n${NODE_INTERNAL_LINE}`;

    logError('billing.chargeCustomer', wrapper);

    const [, , properties] = capturePostHogException.mock.calls[0] as [
      Error,
      string,
      Record<string, unknown>,
    ];
    expect(properties.$exception_fingerprint).toBe(
      'billing.chargeCustomer:FeatureError:InternalDriverError'
    );
  });

  it('keeps the existing pgFields extraction from the cause chain intact', () => {
    const pgError = new Error('duplicate key value violates unique constraint');
    pgError.name = 'PostgresError';
    pgError.stack = `PostgresError: duplicate key\n${NODE_INTERNAL_LINE}`;
    Object.assign(pgError, {
      code: '23505',
      detail: 'Key (email)=(a@b.com) already exists.',
      table_name: 'practitioners',
    });

    const wrapper = new Error('Failed to create practitioner', {
      cause: pgError,
    });
    wrapper.name = 'FeatureError';
    wrapper.stack = `FeatureError: Failed to create practitioner\n${APPS_API_LINE}`;

    logError('practitioners.createPractitioner', wrapper);

    const [, , properties] = capturePostHogException.mock.calls[0] as [
      Error,
      string,
      Record<string, unknown>,
    ];
    expect(properties.dbCode).toBe('23505');
    expect(properties.dbDetail).toBe('Key (email)=(a@b.com) already exists.');
    expect(properties.dbTable).toBe('practitioners');
  });
});

describe('BetterStack survives Sentry being off', () => {
  // BetterStack Errors used to be fed ONLY from Sentry's beforeSend hook, so
  // disabling Sentry silently stopped BetterStack ingestion too. These lock the
  // fallback path that makes the two separable.
  beforeEach(() => vi.clearAllMocks());

  it('does NOT double-send while Sentry is initialized', () => {
    // Sentry is live here (initSentry ran above), so its beforeSend bridge
    // already carries the event. Sending again would duplicate every error.
    logError('billing.checkout', new Error('boom'));
    logWarning('upload.analysisTimeout', 'degraded');

    expect(forwardErrorToBetterStack).not.toHaveBeenCalled();
  });

  it('sends directly when Sentry is NOT initialized', async () => {
    vi.resetModules();
    const fresh = await import('./client.js');
    vi.clearAllMocks();

    fresh.logError('billing.checkout', new Error('boom'), {
      feature: 'billing',
    });
    expect(forwardErrorToBetterStack).toHaveBeenCalledTimes(1);

    fresh.logWarning('upload.analysisTimeout', 'degraded');
    expect(forwardErrorToBetterStack).toHaveBeenCalledTimes(2);
    // The warning must not be filed as an error in BetterStack.
    const [, warnCtx] = forwardErrorToBetterStack.mock.calls[1] as [
      Error,
      { level?: string },
    ];
    expect(warnCtx.level).toBe('warning');

    fresh.captureException(new Error('from captureException'));
    expect(forwardErrorToBetterStack).toHaveBeenCalledTimes(3);
  });
});
