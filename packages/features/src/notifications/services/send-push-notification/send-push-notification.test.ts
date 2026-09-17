import {
  getDeployEnvironment,
  getMockLogger,
  logError,
} from '@borradh-workspace/observability';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { afterEach, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { dispatchApns } from './dispatch-apns.js';
import { dispatchExpo } from './dispatch-expo.js';
import { dispatchFcm } from './dispatch-fcm.js';
import { sendPushNotification } from './send-push-notification.service.js';

// The service is just a router now — verify the routing logic without
// exercising real SDK calls. The three dispatchers are canonically mocked via
// vite.config.ts (absolute-path alias -> src/__mocks__/push-dispatchers.ts), so
// the real Expo/Firebase/APNs wrappers never load. A per-file `vi.mock` would
// leak under `isolate: false` (the real service is pulled into the shared worker
// graph by other services' tests). Drive the mocks with `vi.mocked()`. See
// docs/plans/features-test-suite-speedup.md.
const mockDispatchExpo = vi.mocked(dispatchExpo);
const mockDispatchFcm = vi.mocked(dispatchFcm);
const mockDispatchApns = vi.mocked(dispatchApns);

const emptyResult = { sent: 0, failed: 0, invalidTokens: [] };

// The service takes its logger once at module scope, so grab the same instance
// by name rather than reaching into `createLogger.mock.results` (cleared every
// beforeEach, and shared with other files under `isolate: false`).
const pushLogger = getMockLogger('notifications.push');

describe('sendPushNotification', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockDispatchExpo.mockResolvedValue(emptyResult);
    mockDispatchFcm.mockResolvedValue(emptyResult);
    mockDispatchApns.mockResolvedValue(emptyResult);
  });

  const validInput = {
    userId: 'user_123',
    title: 'Test Notification',
    body: 'This is a test',
  };

  it('routes Expo tokens to dispatchExpo', async () => {
    mockDb.query.devicePushToken.findMany.mockResolvedValueOnce([
      {
        id: 't1',
        userId: 'user_123',
        token: 'ExponentPushToken[abc]',
        platform: 'ios',
        tokenType: 'expo',
      },
    ]);
    mockDispatchExpo.mockResolvedValueOnce({
      sent: 1,
      failed: 0,
      invalidTokens: [],
    });

    await expectResult(
      sendPushNotification(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.sent).toBe(1);
      expect(data.failed).toBe(0);
    });

    expect(mockDispatchExpo).toHaveBeenCalledWith(
      expect.objectContaining({ tokens: ['ExponentPushToken[abc]'] })
    );
    expect(mockDispatchFcm).toHaveBeenCalledWith(
      expect.objectContaining({ tokens: [] })
    );
    expect(mockDispatchApns).toHaveBeenCalledWith(
      expect.objectContaining({ tokens: [] })
    );
  });

  it('routes APNs tokens to dispatchApns and FCM to dispatchFcm', async () => {
    mockDb.query.devicePushToken.findMany.mockResolvedValueOnce([
      {
        id: 't1',
        userId: 'user_123',
        token: 'apns_token_1',
        platform: 'ios',
        tokenType: 'apns',
      },
      {
        id: 't2',
        userId: 'user_123',
        token: 'fcm_token_1',
        platform: 'android',
        tokenType: 'fcm',
      },
    ]);
    mockDispatchApns.mockResolvedValueOnce({
      sent: 1,
      failed: 0,
      invalidTokens: [],
    });
    mockDispatchFcm.mockResolvedValueOnce({
      sent: 1,
      failed: 0,
      invalidTokens: [],
    });

    await expectResult(
      sendPushNotification(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.sent).toBe(2);
    });

    expect(mockDispatchApns).toHaveBeenCalledWith(
      expect.objectContaining({ tokens: ['apns_token_1'] })
    );
    expect(mockDispatchFcm).toHaveBeenCalledWith(
      expect.objectContaining({ tokens: ['fcm_token_1'] })
    );
  });

  it('returns 0 sent when user has no tokens', async () => {
    mockDb.query.devicePushToken.findMany.mockResolvedValueOnce([]);

    await expectResult(
      sendPushNotification(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.sent).toBe(0);
      expect(data.failed).toBe(0);
    });

    expect(mockDispatchExpo).not.toHaveBeenCalled();
    expect(mockDispatchFcm).not.toHaveBeenCalled();
    expect(mockDispatchApns).not.toHaveBeenCalled();
  });

  it('aggregates sent + failed across dispatchers', async () => {
    mockDb.query.devicePushToken.findMany.mockResolvedValueOnce([
      {
        id: 't1',
        userId: 'user_123',
        token: 'ExponentPushToken[abc]',
        platform: 'ios',
        tokenType: 'expo',
      },
      {
        id: 't2',
        userId: 'user_123',
        token: 'fcm_token',
        platform: 'android',
        tokenType: 'fcm',
      },
    ]);
    mockDispatchExpo.mockResolvedValueOnce({
      sent: 1,
      failed: 0,
      invalidTokens: [],
    });
    mockDispatchFcm.mockResolvedValueOnce({
      sent: 0,
      failed: 1,
      invalidTokens: [],
    });

    await expectResult(
      sendPushNotification(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.sent).toBe(1);
      expect(data.failed).toBe(1);
    });
  });

  it('cleans up invalid tokens reported by any dispatcher', async () => {
    mockDb.query.devicePushToken.findMany.mockResolvedValueOnce([
      {
        id: 't1',
        userId: 'user_123',
        token: 'apns_dead',
        platform: 'ios',
        tokenType: 'apns',
      },
      {
        id: 't2',
        userId: 'user_123',
        token: 'apns_live',
        platform: 'ios',
        tokenType: 'apns',
      },
    ]);
    mockDispatchApns.mockResolvedValueOnce({
      sent: 1,
      failed: 1,
      invalidTokens: ['apns_dead'],
    });
    mockDb.where.mockResolvedValueOnce(undefined);

    await expectResult(
      sendPushNotification(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.failed).toBe(1);
    });

    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('fails when the user had tokens and nothing was delivered', async () => {
    // Regression: this used to return ok({ sent: 0, failed: n }). Every caller
    // is best-effort and none inspect the counts, so a total delivery outage
    // was indistinguishable from success and never alerted.
    mockDb.query.devicePushToken.findMany.mockResolvedValueOnce([
      {
        id: 't1',
        userId: 'user_123',
        token: 'apns_token_1',
        platform: 'ios',
        tokenType: 'apns',
      },
    ]);
    mockDispatchApns.mockResolvedValueOnce({
      sent: 0,
      failed: 1,
      invalidTokens: [],
    });

    await expectResult(
      sendPushNotification(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });

  it('surfaces missing provider credentials in the error message', async () => {
    mockDb.query.devicePushToken.findMany.mockResolvedValueOnce([
      {
        id: 't1',
        userId: 'user_123',
        token: 'apns_token_1',
        platform: 'ios',
        tokenType: 'apns',
      },
    ]);
    mockDispatchApns.mockResolvedValueOnce({
      sent: 0,
      failed: 1,
      invalidTokens: [],
      configError: 'APNs not configured (APNS_KEY_ID / APNS_TEAM_ID)',
    });

    const result = await sendPushNotification(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('APNs not configured');
    }
  });

  it('logs a delivery line naming the provider that landed the push', async () => {
    // Without a success line the only push signal in Better Stack is the
    // failure path, so a silent graph cannot be told apart from "nothing has
    // tried to push" — the ambiguity that made confirming a production outage
    // hard in either direction.
    mockDb.query.devicePushToken.findMany.mockResolvedValueOnce([
      {
        id: 't1',
        userId: 'user_123',
        token: 'fcm_token_1',
        platform: 'android',
        tokenType: 'fcm',
      },
    ]);
    mockDispatchFcm.mockResolvedValueOnce({
      sent: 1,
      failed: 0,
      invalidTokens: [],
    });

    const result = await sendPushNotification(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(pushLogger.info).toHaveBeenCalledWith(
      'Push delivered',
      expect.objectContaining({
        operation: 'notifications.sendPushNotification',
        userId: 'user_123',
        sent: 1,
        sentByProvider: { fcm: 1 },
      })
    );
    expect(logError).not.toHaveBeenCalled();
  });

  it('does not log a delivery line when nothing was delivered', async () => {
    mockDb.query.devicePushToken.findMany.mockResolvedValueOnce([
      {
        id: 't1',
        userId: 'user_123',
        token: 'fcm_token_1',
        platform: 'android',
        tokenType: 'fcm',
      },
    ]);
    mockDispatchFcm.mockResolvedValueOnce({
      sent: 0,
      failed: 1,
      invalidTokens: [],
    });

    await sendPushNotification(mockDb as never, validInput);

    expect(pushLogger.info).not.toHaveBeenCalled();
  });

  describe('an environment with no push credentials', () => {
    // Preview ships without FCM_SERVICE_ACCOUNT_BASE64 / APNS_KEY_P8_BASE64 on
    // purpose (.github/preview.env), so every push there fails as
    // "not configured". That is a deployment fact, not an outage — and it is
    // where all 57 events of Sentry issue API-FC came from.
    const unconfigured = {
      sent: 0,
      failed: 1,
      invalidTokens: [],
      configError: 'FCM not configured (FCM_SERVICE_ACCOUNT_BASE64)',
    };
    const oneFcmToken = [
      {
        id: 't1',
        userId: 'user_123',
        token: 'fcm_token_1',
        platform: 'android',
        tokenType: 'fcm',
      },
    ];

    afterEach(() => {
      vi.mocked(getDeployEnvironment).mockReturnValue('production');
    });

    it('warns instead of paging when it is not production', async () => {
      vi.mocked(getDeployEnvironment).mockReturnValue('preview');
      mockDb.query.devicePushToken.findMany.mockResolvedValueOnce(oneFcmToken);
      mockDispatchFcm.mockResolvedValueOnce(unconfigured);

      const result = await sendPushNotification(mockDb as never, validInput);

      // Still a failed Result — callers and metrics see no change.
      expect(result.success).toBe(false);
      expect(logError).not.toHaveBeenCalled();
      expect(pushLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Push delivery skipped'),
        expect.objectContaining({ environment: 'preview' })
      );
    });

    it('still pages in production', async () => {
      // PR #798 exists because credentials silently absent in prod went
      // unnoticed for weeks. That loudness must survive this change.
      vi.mocked(getDeployEnvironment).mockReturnValue('production');
      mockDb.query.devicePushToken.findMany.mockResolvedValueOnce(oneFcmToken);
      mockDispatchFcm.mockResolvedValueOnce(unconfigured);

      const result = await sendPushNotification(mockDb as never, validInput);

      expect(result.success).toBe(false);
      expect(logError).toHaveBeenCalledWith(
        'notifications.sendPushNotification',
        expect.anything(),
        expect.objectContaining({ feature: 'notifications' })
      );
    });

    it('still pages outside production when a configured provider rejects the send', async () => {
      // Only the *unconfigured* case is expected. A preview that has
      // credentials and still delivers nothing is a real fault.
      vi.mocked(getDeployEnvironment).mockReturnValue('preview');
      mockDb.query.devicePushToken.findMany.mockResolvedValueOnce(oneFcmToken);
      mockDispatchFcm.mockResolvedValueOnce({
        sent: 0,
        failed: 1,
        invalidTokens: [],
      });

      await sendPushNotification(mockDb as never, validInput);

      expect(logError).toHaveBeenCalled();
    });
  });

  it('does not error when the only failures were dead tokens', async () => {
    // An uninstalled app is the expected end of a token's life, not an outage.
    // Erroring here would page on every notification to a user whose only
    // device is gone — and the token is deleted below, so it self-heals.
    mockDb.query.devicePushToken.findMany.mockResolvedValueOnce([
      {
        id: 't1',
        userId: 'user_123',
        token: 'apns_dead',
        platform: 'ios',
        tokenType: 'apns',
      },
    ]);
    mockDispatchApns.mockResolvedValueOnce({
      sent: 0,
      failed: 1,
      invalidTokens: ['apns_dead'],
    });
    mockDb.where.mockResolvedValueOnce(undefined);

    await expectResult(
      sendPushNotification(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.failed).toBe(1);
    });

    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('still deletes invalid tokens when a real failure also occurred', async () => {
    // Cleanup must not be skipped just because the overall Result is an error.
    // One dead token + one genuine failure => realFailures = 1 => error.
    mockDb.query.devicePushToken.findMany.mockResolvedValueOnce([
      {
        id: 't1',
        userId: 'user_123',
        token: 'apns_dead',
        platform: 'ios',
        tokenType: 'apns',
      },
      {
        id: 't2',
        userId: 'user_123',
        token: 'apns_broken',
        platform: 'ios',
        tokenType: 'apns',
      },
    ]);
    mockDispatchApns.mockResolvedValueOnce({
      sent: 0,
      failed: 2,
      invalidTokens: ['apns_dead'],
    });
    mockDb.where.mockResolvedValueOnce(undefined);

    await expectResult(
      sendPushNotification(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);

    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing fields', async () => {
    await expectResult(
      sendPushNotification(mockDb as never, {
        userId: '',
        title: 'Test',
        body: 'Body',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    await expectResult(
      sendPushNotification(mockDb as never, {
        userId: 'user_123',
        title: '',
        body: 'Body',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    await expectResult(
      sendPushNotification(mockDb as never, {
        userId: 'user_123',
        title: 'Test',
        body: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('passes data payload through to dispatchers', async () => {
    mockDb.query.devicePushToken.findMany.mockResolvedValueOnce([
      {
        id: 't1',
        userId: 'user_123',
        token: 'ExponentPushToken[abc]',
        platform: 'ios',
        tokenType: 'expo',
      },
    ]);

    await sendPushNotification(mockDb as never, {
      ...validInput,
      data: { screen: 'payments' },
    });

    expect(mockDispatchExpo).toHaveBeenCalledWith(
      expect.objectContaining({ data: { screen: 'payments' } })
    );
  });
});
