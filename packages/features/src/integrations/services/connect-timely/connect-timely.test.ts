import {
  TimelyOAuthService,
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

import { connectTimely } from './connect-timely.service.js';

const timelyOAuthService = new TimelyOAuthService() as {
  exchangeCodeForTokens: ReturnType<typeof vi.fn>;
  getAccounts: ReturnType<typeof vi.fn>;
};
const mockExchangeCodeForTokens = vi.mocked(
  timelyOAuthService.exchangeCodeForTokens
);
const mockGetAccounts = vi.mocked(timelyOAuthService.getAccounts);
const mockEncryptCredentials = vi.mocked(encryptCredentials);

describe('connectTimely', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockEncryptCredentials.mockReturnValue('encrypted_credentials');
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
  };

  const mockAccounts = [
    {
      id: 12345,
      name: 'Test Salon',
      email: 'test@timely.com',
    },
  ];

  it('should connect Timely account successfully', async () => {
    mockExchangeCodeForTokens.mockResolvedValueOnce(mockTokens);
    mockGetAccounts.mockResolvedValueOnce(mockAccounts);
    mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce(null);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'booking_123',
        organizationId: 'org_123',
        provider: 'timely',
        email: 'test@timely.com',
        displayName: 'Test Salon',
        isActive: true,
      },
    ]);

    const result = await connectTimely(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe('timely');
      expect(result.data.email).toBe('test@timely.com');
    }
  });

  it('should return EXTERNAL_SERVICE_ERROR when no Timely accounts found', async () => {
    mockExchangeCodeForTokens.mockResolvedValueOnce(mockTokens);
    mockGetAccounts.mockResolvedValueOnce([]);

    await expectResult(connectTimely(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.EXTERNAL_SERVICE_ERROR);
        expect(error.message).toContain('No Timely accounts found');
      }
    );
  });

  it('should return ALREADY_EXISTS when Timely account is already connected', async () => {
    mockExchangeCodeForTokens.mockResolvedValueOnce(mockTokens);
    mockGetAccounts.mockResolvedValueOnce(mockAccounts);
    mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce({
      id: 'existing_booking',
      provider: 'timely',
      externalAccountId: '12345',
    });

    await expectResult(connectTimely(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.ALREADY_EXISTS);
        expect(error.message).toContain('Test Salon');
      }
    );
  });

  it('should return EXTERNAL_SERVICE_ERROR when token exchange fails', async () => {
    mockExchangeCodeForTokens.mockRejectedValueOnce(
      new Error('Failed to exchange code')
    );

    await expectResult(connectTimely(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.EXTERNAL_SERVICE_ERROR);
      }
    );
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      userId: 'user_123',
      code: 'oauth_code_123',
    };

    await expectResult(
      connectTimely(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return INTERNAL_ERROR on database failure', async () => {
    mockExchangeCodeForTokens.mockResolvedValueOnce(mockTokens);
    mockGetAccounts.mockResolvedValueOnce(mockAccounts);
    mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce(null);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockRejectedValueOnce(new Error('Database error'));

    await expectResult(
      connectTimely(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
