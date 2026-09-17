import {
  GoogleCalendarOAuthService,
  GoogleCalendarService,
} from '@borradh-workspace/integrations';
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
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

import { listGoogleCalendars } from './list-google-calendars.service.js';

const calendarOAuthService = new GoogleCalendarOAuthService() as {
  refreshAccessToken: ReturnType<typeof vi.fn>;
};
const calendarService = new GoogleCalendarService() as {
  listCalendars: ReturnType<typeof vi.fn>;
};
const mocks = {
  mockDecryptCredentials: vi.mocked(decryptCredentials),
  mockRefreshAccessToken: vi.mocked(calendarOAuthService.refreshAccessToken),
  mockListCalendars: vi.mocked(calendarService.listCalendars),
};

describe('listGoogleCalendars', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    accountId: 'acc_123',
  };

  it('should list writable Google calendars', async () => {
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce({
      id: 'acc_123',
      organizationId: 'org_123',
      encryptedCredentials: 'encrypted_data',
      tokenExpiresAt: new Date(Date.now() + 3600000), // Not expired
    });
    mocks.mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'token_123',
      refreshToken: 'refresh_123',
      expiresIn: 3600,
    });
    mocks.mockListCalendars.mockResolvedValueOnce([
      {
        id: 'cal_1',
        summary: 'Primary',
        timeZone: 'UTC',
        primary: true,
        accessRole: 'owner',
      },
      {
        id: 'cal_2',
        summary: 'Shared',
        timeZone: 'UTC',
        primary: false,
        accessRole: 'reader',
      },
    ]);

    const result = await listGoogleCalendars(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      // Only writable calendars returned
      expect(result.data).toHaveLength(1);
      expect(result.data[0].summary).toBe('Primary');
    }
  });

  it('should refresh expired token', async () => {
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce({
      id: 'acc_123',
      organizationId: 'org_123',
      encryptedCredentials: 'encrypted_data',
      tokenExpiresAt: new Date(Date.now() - 3600000), // Expired
    });
    mocks.mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'old_token',
      refreshToken: 'refresh_123',
      expiresIn: 3600,
    });
    mocks.mockRefreshAccessToken.mockResolvedValueOnce({
      accessToken: 'new_token',
    });
    mocks.mockListCalendars.mockResolvedValueOnce([]);

    const result = await listGoogleCalendars(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mocks.mockRefreshAccessToken).toHaveBeenCalledWith('refresh_123');
  });

  it('should return NOT_FOUND when account not found', async () => {
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      listGoogleCalendars(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return VALIDATION_ERROR for empty accountId', async () => {
    await expectResult(
      listGoogleCalendars(mockDb as never, { ...validInput, accountId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return INTERNAL_ERROR when API fails', async () => {
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce({
      id: 'acc_123',
      organizationId: 'org_123',
      encryptedCredentials: 'encrypted_data',
      tokenExpiresAt: new Date(Date.now() + 3600000),
    });
    mocks.mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'token_123',
    });
    mocks.mockListCalendars.mockRejectedValueOnce(
      new Error('Google API error')
    );

    await expectResult(
      listGoogleCalendars(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
