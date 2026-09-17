import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockTrackEvent = vi.fn();
const mockAddBreadcrumb = vi.fn();
const mockLogError = vi.fn();

vi.mock('./posthog/index.js', () => ({
  isPostHogInitialized: () => true,
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

vi.mock('./sentry/index.js', () => ({
  isSentryInitialized: () => true,
  addBreadcrumb: (...args: unknown[]) => mockAddBreadcrumb(...args),
  captureException: vi.fn(),
  logError: (...args: unknown[]) => mockLogError(...args),
}));

vi.mock('./context.js', () => ({
  getActiveFlags: () => [],
  getCurrentOrganizationId: () => undefined,
  getCurrentUserId: () => 'user-1',
  getCurrentUserSetProps: () => undefined,
}));

import { trackedResult } from './tracked.js';

const failure = (code: string) => ({
  success: false as const,
  error: { code, message: `${code} happened` },
});

/** All `.error` events emitted to PostHog for a given event name. */
const errorEvents = (eventName: string) =>
  mockTrackEvent.mock.calls.filter((c) => c[1] === `${eventName}.error`);

describe('trackedResult internalErrorsOnly', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('suppresses PostHog error events for expected codes (NOT_FOUND, FORBIDDEN)', async () => {
    for (const code of ['NOT_FOUND', 'FORBIDDEN', 'UNAUTHORIZED', 'CONFLICT']) {
      const result = await trackedResult(
        'feature.doThing',
        async () => failure(code),
        { internalErrorsOnly: true }
      );
      expect(result.success).toBe(false);
    }

    expect(errorEvents('feature.doThing')).toHaveLength(0);
  });

  it('still emits PostHog error events for internal codes', async () => {
    for (const code of [
      'INTERNAL_ERROR',
      'DATABASE_ERROR',
      'EXTERNAL_SERVICE_ERROR',
      'UNKNOWN_ERROR',
    ]) {
      await trackedResult('feature.doThing', async () => failure(code), {
        internalErrorsOnly: true,
      });
    }

    const events = errorEvents('feature.doThing');
    expect(events).toHaveLength(4);
    expect(
      events.map((c) => (c[2] as { error_code: string }).error_code)
    ).toEqual([
      'INTERNAL_ERROR',
      'DATABASE_ERROR',
      'EXTERNAL_SERVICE_ERROR',
      'UNKNOWN_ERROR',
    ]);
  });

  it('emits error events for expected codes when internalErrorsOnly is not set (default)', async () => {
    await trackedResult('feature.doThing', async () => failure('NOT_FOUND'));

    expect(errorEvents('feature.doThing')).toHaveLength(1);
  });

  it('keeps the Sentry failure breadcrumb even when the event is suppressed', async () => {
    await trackedResult('feature.doThing', async () => failure('NOT_FOUND'), {
      internalErrorsOnly: true,
    });

    expect(
      mockAddBreadcrumb.mock.calls.some((c) =>
        String((c[0] as { message: string }).message).startsWith(
          'Failed: feature.doThing'
        )
      )
    ).toBe(true);
  });

  it('leaves the thrown-exception path unaffected by internalErrorsOnly', async () => {
    const result = await trackedResult(
      'feature.doThing',
      async () => {
        throw new Error('boom');
      },
      { internalErrorsOnly: true }
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INTERNAL_ERROR');
    expect(mockLogError).toHaveBeenCalled();
    expect(
      mockTrackEvent.mock.calls.filter(
        (c) => c[1] === 'feature.doThing.exception'
      )
    ).toHaveLength(1);
  });
});

describe('trackedResult exception cause enrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes causeMessage and pg fields from the error cause', async () => {
    const pgError = Object.assign(new Error('duplicate key value'), {
      code: '23505',
      detail: 'Key (email)=(a@b.c) already exists.',
      constraint_name: 'user_email_unique',
    });
    const wrapper = new Error('Failed query: insert into "user" ...', {
      cause: pgError,
    });

    const result = await trackedResult('feature.doThing', async () => {
      throw wrapper;
    });

    expect(result.success).toBe(false);
    expect(result.error?.details).toEqual({
      originalError: 'Failed query: insert into "user" ...',
      causeMessage: 'duplicate key value',
      dbCode: '23505',
      dbDetail: 'Key (email)=(a@b.c) already exists.',
      dbConstraint: 'user_email_unique',
    });
  });

  it('includes only causeMessage when the cause has no pg fields', async () => {
    const result = await trackedResult('feature.doThing', async () => {
      throw new Error('outer', { cause: new Error('inner') });
    });

    expect(result.success).toBe(false);
    expect(result.error?.details).toEqual({
      originalError: 'outer',
      causeMessage: 'inner',
    });
  });

  it('omits cause fields when there is no cause', async () => {
    const result = await trackedResult('feature.doThing', async () => {
      throw new Error('plain');
    });

    expect(result.success).toBe(false);
    expect(result.error?.details).toEqual({ originalError: 'plain' });
  });
});
