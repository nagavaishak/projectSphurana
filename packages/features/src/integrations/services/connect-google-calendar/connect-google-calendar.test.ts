import {
  GoogleCalendarOAuthService,
  GoogleCalendarService,
  encryptCredentials,
} from '@borradh-workspace/integrations';
import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import * as startCalendarWatchModule from '../../../calendar/services/start-calendar-watch/start-calendar-watch.service.js';
import { ErrorCodes } from '../../../shared/index.js';
import { connectGoogleCalendar } from './connect-google-calendar.service.js';

// Restored `vi.spyOn`, NOT `vi.mock` — under `isolate: false` all files in a
// worker share one module graph, so a hoisted bare-factory mock of an internal
// module leaks outward (deleting the exports it omits) and silently misses
// whenever an earlier file already imported the real module
// (start-calendar-watch.test.ts does). Spies are installed at run time and
// restored, so neither hazard applies.
let mockStartCalendarWatch: MockInstance;

const calendarOAuthService = new GoogleCalendarOAuthService() as {
  exchangeCodeForTokens: ReturnType<typeof vi.fn>;
  getUserInfo: ReturnType<typeof vi.fn>;
};
const calendarService = new GoogleCalendarService() as {
  createCalendar: ReturnType<typeof vi.fn>;
};
const mockExchangeCodeForTokens = vi.mocked(
  calendarOAuthService.exchangeCodeForTokens
);
const mockGetUserInfo = vi.mocked(calendarOAuthService.getUserInfo);
const mockCreateCalendar = vi.mocked(calendarService.createCalendar);
const mockEncryptCredentials = vi.mocked(encryptCredentials);

describe('connectGoogleCalendar', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockEncryptCredentials.mockReturnValue('encrypted_credentials');
    // Stub the watch registration so connecting has no side effects.
    mockStartCalendarWatch = vi
      .spyOn(startCalendarWatchModule, 'startCalendarWatch')
      .mockResolvedValue({ success: true, data: {} } as never);
  });

  afterEach(() => {
    mockStartCalendarWatch.mockRestore();
  });

  const validInput = {
    organizationId: 'org_123',
    userId: 'user_123',
    code: 'oauth_code_123',
  };

  const mockTokens = {
    accessToken: 'access_token_123',
    refreshToken: 'refresh_token_123',
    tokenType: 'Bearer',
    expiresIn: 3600,
    scope: 'https://www.googleapis.com/auth/calendar',
  };

  const mockUserInfo = {
    email: 'user@gmail.com',
    name: 'Test User',
  };

  const mockBorradhCalendar = {
    id: 'borradh_cal_123',
    summary: 'Borradh',
    timeZone: 'America/New_York',
  };

  it('should connect Google Calendar successfully', async () => {
    mockExchangeCodeForTokens.mockResolvedValueOnce(mockTokens);
    mockGetUserInfo.mockResolvedValueOnce(mockUserInfo);
    mockCreateCalendar.mockResolvedValueOnce(mockBorradhCalendar);
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce(null);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'cal_123',
        organizationId: 'org_123',
        provider: 'google',
        email: 'user@gmail.com',
        isActive: true,
      },
    ]);
    // Mock the organization update for primaryCalendarAccountId
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValueOnce(undefined);

    const result = await connectGoogleCalendar(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('user@gmail.com');
    }
    expect(mockCreateCalendar).toHaveBeenCalledWith('Borradh');
  });

  it('should return ALREADY_EXISTS when calendar is already connected', async () => {
    mockExchangeCodeForTokens.mockResolvedValueOnce(mockTokens);
    mockGetUserInfo.mockResolvedValueOnce(mockUserInfo);
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce({
      id: 'existing_cal',
      email: 'user@gmail.com',
    });

    const result = await connectGoogleCalendar(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.ALREADY_EXISTS);
      expect(result.error.message).toContain('user@gmail.com');
    }
  });

  it('should return INTERNAL_ERROR when createCalendar fails', async () => {
    mockExchangeCodeForTokens.mockResolvedValueOnce(mockTokens);
    mockGetUserInfo.mockResolvedValueOnce(mockUserInfo);
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce(null);
    mockCreateCalendar.mockRejectedValueOnce(
      new Error('Cannot create calendar')
    );

    const result = await connectGoogleCalendar(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('should return EXTERNAL_SERVICE_ERROR when token exchange fails', async () => {
    mockExchangeCodeForTokens.mockRejectedValueOnce(
      new Error('Failed to exchange code')
    );

    const result = await connectGoogleCalendar(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.EXTERNAL_SERVICE_ERROR);
    }
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      userId: 'user_123',
      code: 'oauth_code_123',
    };

    const result = await connectGoogleCalendar(
      mockDb as never,
      invalidInput as never
    );

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing userId', async () => {
    const invalidInput = {
      organizationId: 'org_123',
      code: 'oauth_code_123',
    };

    const result = await connectGoogleCalendar(
      mockDb as never,
      invalidInput as never
    );

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return INTERNAL_ERROR on database failure', async () => {
    mockExchangeCodeForTokens.mockResolvedValueOnce(mockTokens);
    mockGetUserInfo.mockResolvedValueOnce(mockUserInfo);
    mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce(null);
    mockCreateCalendar.mockResolvedValueOnce(mockBorradhCalendar);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockRejectedValueOnce(new Error('Database error'));

    const result = await connectGoogleCalendar(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
  });
});
