import {
  GoogleCalendarOAuthService,
  GoogleCalendarService,
  decryptCredentials,
  encryptCredentials,
} from '@borradh-workspace/integrations';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';

import { startCalendarWatch } from './start-calendar-watch.service.js';

// Canonical integration-service mocks return a stable shared instance whose
// methods are auto-vivified vi.fn()s.
const calendarServiceInstance = new (
  GoogleCalendarService as never as new () => {
    watchEvents: ReturnType<typeof vi.fn>;
    listEventsWithSyncToken: ReturnType<typeof vi.fn>;
  }
)();
const calendarOAuthInstance = new (
  GoogleCalendarOAuthService as never as new () => {
    refreshAccessToken: ReturnType<typeof vi.fn>;
  }
)();
const mockWatchEvents = vi.mocked(calendarServiceInstance.watchEvents);
const mockListEventsWithSyncToken = vi.mocked(
  calendarServiceInstance.listEventsWithSyncToken
);
const mockRefreshAccessToken = vi.mocked(
  calendarOAuthInstance.refreshAccessToken
);
const mockDecryptCredentials = vi.mocked(decryptCredentials);
const mockEncryptCredentials = vi.mocked(encryptCredentials);

const mockDb = createMockDatabase();

const validInput = {
  calendarAccountId: 'cal-1',
  organizationId: 'org-1',
};

const mockCalAccount = {
  id: 'cal-1',
  organizationId: 'org-1',
  isActive: true,
  syncEnabled: true,
  calendarId: 'primary',
  encryptedCredentials: 'encrypted',
  tokenExpiresAt: new Date(Date.now() + 3600000),
};

describe('startCalendarWatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockDecryptCredentials.mockReturnValue({
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      expiresIn: 3600,
    });
    mockEncryptCredentials.mockReturnValue('encrypted');
  });

  it('should start a calendar watch successfully', async () => {
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce(
      mockCalAccount
    );
    mockWatchEvents.mockResolvedValueOnce({
      resourceId: 'resource-1',
      expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    mockListEventsWithSyncToken.mockResolvedValueOnce({
      events: [],
      nextSyncToken: 'sync-token-1',
    });
    mockDb.returning.mockResolvedValueOnce([{}]);

    const result = await startCalendarWatch(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.watchResourceId).toBe('resource-1');
      expect(result.data.watchChannelId).toBeDefined();
    }
  });

  it('should return VALIDATION_ERROR for empty calendarAccountId', async () => {
    await expectResult(
      startCalendarWatch(mockDb as never, {
        calendarAccountId: '',
        organizationId: 'org-1',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return NOT_FOUND when calendar account does not exist', async () => {
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      startCalendarWatch(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return VALIDATION_ERROR when account is inactive', async () => {
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce({
      ...mockCalAccount,
      isActive: false,
    });

    await expectResult(
      startCalendarWatch(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR when sync is disabled', async () => {
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce({
      ...mockCalAccount,
      syncEnabled: false,
    });

    await expectResult(
      startCalendarWatch(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return INTERNAL_ERROR when Google API fails', async () => {
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce(
      mockCalAccount
    );
    mockWatchEvents.mockRejectedValueOnce(new Error('Google API error'));

    await expectResult(
      startCalendarWatch(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });

  it('should refresh token when expired', async () => {
    const expiredAccount = {
      ...mockCalAccount,
      tokenExpiresAt: new Date(Date.now() - 1000),
    };
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce(
      expiredAccount
    );
    mockRefreshAccessToken.mockResolvedValueOnce({
      accessToken: 'new-token',
      refreshToken: 'new-refresh',
      expiresIn: 3600,
    });
    mockDb.returning.mockResolvedValueOnce([{}]); // token update
    mockWatchEvents.mockResolvedValueOnce({
      resourceId: 'resource-1',
      expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    mockListEventsWithSyncToken.mockResolvedValueOnce({
      events: [],
      nextSyncToken: 'sync-token-1',
    });
    mockDb.returning.mockResolvedValueOnce([{}]); // watch update

    const result = await startCalendarWatch(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockRefreshAccessToken).toHaveBeenCalled();
  });
});
