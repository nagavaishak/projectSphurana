import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// Isolation note (isolate: false):
// `@borradh-workspace/integrations` is canonically mocked in vite.config.ts and
// re-exports the Meta error classifier (`getMetaErrorInfo`, `getMetaErrorMessage`,
// `isMetaAuthError`) as the REAL pure-logic functions. A hoisted per-file
// `vi.mock('@borradh-workspace/integrations', ...)` replaces the whole module in
// the SHARED registry and races with whichever file loads first.
//
// This test needs to drive those classifier functions with synthetic return
// values, so we register the integrations stub + the sibling
// `mark-needs-reconnect.service` mock with `vi.doMock` (non-hoisted, scoped) +
// `vi.resetModules()` + a dynamic `import()` of the service inside `beforeEach`.
// Nothing leaks into the shared registry.
//
// `@borradh-workspace/observability` is already mocked globally in
// `src/test-setup.ts`; we read its `logError` from the same post-reset module
// graph the service imports, so the assertion targets the right mock instance.
// ---------------------------------------------------------------------------

const getMetaErrorInfo = vi.fn();
const getMetaErrorMessage = vi.fn();
const isMetaAuthError = vi.fn().mockReturnValue(false);
const extractMetaErrorContext = vi.fn().mockReturnValue({});
const handleMetaAuthError = vi.fn().mockResolvedValue(undefined);

// Real class so `instanceof` works in handle-meta-error.ts
class MetaAppSecretMismatchError extends Error {
  readonly metaError: Error;
  constructor(metaError: Error) {
    super(metaError.message);
    this.name = 'MetaAppSecretMismatchError';
    this.metaError = metaError;
  }
}

let handleMetaError: typeof import('./handle-meta-error.js').handleMetaError;
// `logError` is read from the SAME (post-resetModules) module graph the service
// imports, so the assertion targets the exact mock instance the service calls.
let logError: ReturnType<typeof vi.fn>;
// Same reasoning as `logError` above: read the mock warn logger for
// `createLogger('MetaError')` off the SAME post-resetModules module graph.
let getMockLogger: (name: string) => { warn: ReturnType<typeof vi.fn> };

describe('handleMetaError', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    isMetaAuthError.mockReturnValue(false);
    handleMetaAuthError.mockResolvedValue(undefined);

    vi.doMock('@borradh-workspace/integrations', () => ({
      getMetaErrorInfo,
      getMetaErrorMessage,
      isMetaAuthError,
      extractMetaErrorContext,
      MetaAppSecretMismatchError,
    }));
    vi.doMock(
      '../../../integrations/services/mark-needs-reconnect/mark-needs-reconnect.service.js',
      () => ({
        handleMetaAuthError,
      })
    );

    ({ handleMetaError } = await import('./handle-meta-error.js'));
    ({ logError, getMockLogger } = (await import(
      '@borradh-workspace/observability'
    )) as unknown as {
      logError: ReturnType<typeof vi.fn>;
      getMockLogger: (name: string) => { warn: ReturnType<typeof vi.fn> };
    });

    getMetaErrorMessage.mockReturnValue('Unknown error');
  }, 30_000);

  afterEach(() => {
    vi.doUnmock('@borradh-workspace/integrations');
    vi.doUnmock(
      '../../../integrations/services/mark-needs-reconnect/mark-needs-reconnect.service.js'
    );
    vi.resetModules();
  });

  it('returns structured error with metaErrorInfo when Meta error is recognized', async () => {
    const metaErrorInfo = {
      errorKey: 'META_SOME_ERROR',
      category: 'content_error' as const,
      userTitle: 'Content Error',
      userMessage: 'Your content is invalid',
      retryable: false,
    };
    getMetaErrorInfo.mockReturnValue(metaErrorInfo);

    const result = await handleMetaError(new Error('test'), {
      operationName: 'metaAds.test',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
      expect(result.error.message).toBe('Your content is invalid');
      expect(result.error.details).toEqual({
        metaError: metaErrorInfo,
      });
    }
  });

  it('maps payment_required category to META_PAYMENT_METHOD_REQUIRED', async () => {
    const metaErrorInfo = {
      errorKey: 'META_PAYMENT_ERROR',
      category: 'payment_required' as const,
      userTitle: 'Payment Required',
      userMessage: 'Add a payment method',
      retryable: false,
    };
    getMetaErrorInfo.mockReturnValue(metaErrorInfo);

    const result = await handleMetaError(new Error('test'), {
      operationName: 'metaAds.test',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('META_PAYMENT_METHOD_REQUIRED');
    }
  });

  it('maps META_TOS_LEAD_GEN to META_LEAD_GEN_TOS_REQUIRED with page-specific action URL', async () => {
    const metaErrorInfo = {
      errorKey: 'META_TOS_LEAD_GEN',
      category: 'user_action_required' as const,
      userTitle: 'TOS Required',
      userMessage: 'Accept the Lead Gen TOS',
      actionUrl: 'https://facebook.com/generic-tos',
      retryable: false,
    };
    getMetaErrorInfo.mockReturnValue(metaErrorInfo);

    const result = await handleMetaError(new Error('test'), {
      operationName: 'metaAds.test',
      credentials: { pageId: 'page-123' },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('META_LEAD_GEN_TOS_REQUIRED');
      expect(result.error.details).toEqual({
        metaError: {
          ...metaErrorInfo,
          actionUrl:
            'https://www.facebook.com/ads/leadgen/tos?page_id=page-123',
        },
      });
    }
  });

  it('falls back to defaultErrorCode for unknown errors', async () => {
    getMetaErrorInfo.mockReturnValue(undefined);
    getMetaErrorMessage.mockReturnValue('Something went wrong');

    const result = await handleMetaError(new Error('test'), {
      operationName: 'metaAds.test',
      defaultErrorCode: 'META_SYNC_FAILED',
      defaultUserTitle: 'Sync Failed',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('META_SYNC_FAILED');
      expect(result.error.message).toBe('Sync Failed: Something went wrong');
      expect(result.error.details).toEqual({
        metaError: {
          errorKey: 'META_UNKNOWN_ERROR',
          category: 'unknown',
          userTitle: 'Sync Failed',
          userMessage: 'Something went wrong',
          retryable: false,
        },
      });
    }
  });

  it('extracts error.cause when present (Drizzle wrapping)', async () => {
    const originalError = new Error('original pg error');
    const wrappedError = new Error('Failed query: SELECT ...');
    wrappedError.cause = originalError;

    getMetaErrorInfo.mockReturnValue(undefined);
    getMetaErrorMessage.mockReturnValue('Failed query');

    await handleMetaError(wrappedError, {
      operationName: 'metaAds.test',
      extra: { adId: 'ad-1' },
    });

    expect(logError).toHaveBeenCalledWith('metaAds.test', wrappedError, {
      feature: 'meta-ads',
      extra: {
        adId: 'ad-1',
        pgError: 'original pg error',
      },
    });

    expect(getMetaErrorInfo).toHaveBeenCalledWith(originalError);
  });

  it('calls logError for unknown errors', async () => {
    getMetaErrorInfo.mockReturnValue(undefined);
    getMetaErrorMessage.mockReturnValue('error');

    const error = new Error('test error');
    await handleMetaError(error, {
      operationName: 'metaAds.launchAd',
      extra: { organizationId: 'org-1', videoId: 'vid-1' },
    });

    expect(logError).toHaveBeenCalledWith('metaAds.launchAd', error, {
      feature: 'meta-ads',
      extra: {
        organizationId: 'org-1',
        videoId: 'vid-1',
        pgError: 'test error',
      },
    });
  });

  it('does not log classified errors to Sentry', async () => {
    getMetaErrorInfo.mockReturnValue({
      errorKey: 'META_PAYMENT_ERROR',
      category: 'payment_required' as const,
      userTitle: 'Payment Required',
      userMessage: 'Add a payment method',
      retryable: false,
    });

    await handleMetaError(new Error('test'), {
      operationName: 'metaAds.test',
    });

    expect(logError).not.toHaveBeenCalled();
  });

  // ENG-852 (finding #4): classified errors are never logged to Sentry
  // (expected outcomes), but that left the Meta code/subcode/fbtrace_id
  // behind a production permission failure unrecoverable. A warn-level
  // structured log — never Sentry — keeps that context queryable.
  it('warns with the Meta error context for classified errors', async () => {
    getMetaErrorInfo.mockReturnValue({
      errorKey: 'META_PERMISSION_GENERIC',
      category: 'permission_denied' as const,
      userTitle: 'Permission Denied',
      userMessage: "Your Meta connection doesn't have permission to do this.",
      retryable: false,
    });
    extractMetaErrorContext.mockReturnValue({
      metaErrorCode: 10,
      metaSubcode: 200,
      metaCategory: 'permission_denied',
      metaFbtraceId: 'trace-abc',
      metaType: 'OAuthException',
      metaUserMessage: 'Permission error',
    });

    await handleMetaError(new Error('test'), {
      operationName: 'metaAds.publishAd',
      feature: 'meta-ads',
    });

    const metaErrorLogger = getMockLogger('MetaError');
    expect(metaErrorLogger.warn).toHaveBeenCalledWith(
      'Classified Meta API error',
      {
        operation: 'metaAds.publishAd',
        feature: 'meta-ads',
        errorKey: 'META_PERMISSION_GENERIC',
        category: 'permission_denied',
        metaErrorCode: 10,
        metaSubcode: 200,
        metaFbtraceId: 'trace-abc',
      }
    );
    // Still never Sentry — the whole point of the split.
    expect(logError).not.toHaveBeenCalled();
  });

  it('calls handleMetaAuthError when error is an auth error', async () => {
    isMetaAuthError.mockReturnValue(true);
    getMetaErrorInfo.mockReturnValue({
      errorKey: 'META_AUTH_TOKEN_EXPIRED',
      category: 'auth_required' as const,
      userTitle: 'Token Expired',
      userMessage: 'Please reconnect',
      retryable: false,
    });

    const mockDb = {} as never;
    const error = new Error('token expired');

    await handleMetaError(error, {
      operationName: 'metaAds.test',
      db: mockDb,
      organizationId: 'org-123',
    });

    expect(handleMetaAuthError).toHaveBeenCalledWith(mockDb, error, {
      type: 'meta_ads',
      organizationId: 'org-123',
    });
  });

  it('uses custom defaultUserTitle when provided', async () => {
    getMetaErrorInfo.mockReturnValue(undefined);
    getMetaErrorMessage.mockReturnValue('API failure');

    const result = await handleMetaError(new Error('test'), {
      operationName: 'metaAds.test',
      defaultUserTitle: 'Failed to publish ad',
    });

    if (!result.success) {
      expect(result.error.message).toBe('Failed to publish ad: API failure');
      expect(result.error.details).toEqual({
        metaError: expect.objectContaining({
          userTitle: 'Failed to publish ad',
        }),
      });
    }
  });

  it('uses default values when options are minimal', async () => {
    getMetaErrorInfo.mockReturnValue(undefined);
    getMetaErrorMessage.mockReturnValue('error msg');

    const result = await handleMetaError(new Error('test'), {
      operationName: 'metaAds.test',
    });

    if (!result.success) {
      expect(result.error.code).toBe('META_AD_CREATE_FAILED');
      expect(result.error.message).toBe('Operation Failed: error msg');
    }
  });
});
