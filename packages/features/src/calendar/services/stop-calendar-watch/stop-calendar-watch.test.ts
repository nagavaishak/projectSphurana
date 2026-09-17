import {
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

import { stopCalendarWatch } from './stop-calendar-watch.service.js';

// Canonical integration-service mocks return a stable shared instance whose
// methods are auto-vivified vi.fn()s.
const calendarServiceInstance = new (
  GoogleCalendarService as never as new () => {
    stopWatch: ReturnType<typeof vi.fn>;
  }
)();
const mockStopWatch = vi.mocked(calendarServiceInstance.stopWatch);
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
  watchChannelId: 'channel-1',
  watchResourceId: 'resource-1',
  encryptedCredentials: 'encrypted',
  tokenExpiresAt: new Date(Date.now() + 3600000),
};

describe('stopCalendarWatch', () => {
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

  it('should stop a calendar watch successfully', async () => {
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce(
      mockCalAccount
    );
    mockStopWatch.mockResolvedValueOnce(undefined);

    const result = await stopCalendarWatch(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stopped).toBe(true);
    }
  });

  it('should return VALIDATION_ERROR for empty calendarAccountId', async () => {
    await expectResult(
      stopCalendarWatch(mockDb as never, {
        calendarAccountId: '',
        organizationId: 'org-1',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return NOT_FOUND when account does not exist', async () => {
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      stopCalendarWatch(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return stopped=false when no watch is active', async () => {
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce({
      ...mockCalAccount,
      watchChannelId: null,
      watchResourceId: null,
    });

    const result = await stopCalendarWatch(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stopped).toBe(false);
    }
  });

  it('should succeed even when Google stop API fails', async () => {
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce(
      mockCalAccount
    );
    mockStopWatch.mockRejectedValueOnce(new Error('Channel already expired'));

    const result = await stopCalendarWatch(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stopped).toBe(true);
    }
  });

  it('should return INTERNAL_ERROR on unexpected failure', async () => {
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce(
      mockCalAccount
    );
    mockStopWatch.mockResolvedValueOnce(undefined);
    // Simulate DB update failure after stopWatch succeeds
    // The service uses db.update().set().where() — where() is the terminal call
    mockDb.where.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      stopCalendarWatch(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
