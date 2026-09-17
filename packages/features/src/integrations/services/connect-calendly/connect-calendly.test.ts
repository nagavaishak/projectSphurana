import {
  CalendlyOAuthService,
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

import { connectCalendly } from './connect-calendly.service.js';

const calendlyOAuthService = new CalendlyOAuthService() as {
  exchangeCodeForTokens: ReturnType<typeof vi.fn>;
  getCurrentUser: ReturnType<typeof vi.fn>;
};
const mockExchangeCodeForTokens = vi.mocked(
  calendlyOAuthService.exchangeCodeForTokens
);
const mockGetCurrentUser = vi.mocked(calendlyOAuthService.getCurrentUser);
const mockEncryptCredentials = vi.mocked(encryptCredentials);

describe('connectCalendly', () => {
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
    expiresIn: 7200,
    scope: 'default',
  };

  const mockUserInfo = {
    uri: 'https://api.calendly.com/users/abc123',
    email: 'user@calendly.com',
    name: 'Test User',
    currentOrganization: 'https://api.calendly.com/organizations/xyz',
    schedulingUrl: 'https://calendly.com/testuser',
  };

  it('should connect Calendly account successfully', async () => {
    mockExchangeCodeForTokens.mockResolvedValueOnce(mockTokens);
    mockGetCurrentUser.mockResolvedValueOnce(mockUserInfo);
    mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce(null);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'booking_123',
        organizationId: 'org_123',
        provider: 'calendly',
        email: 'user@calendly.com',
        displayName: 'Test User',
        isActive: true,
        config: {
          calendly: {
            organizationUri: mockUserInfo.currentOrganization,
            schedulingUrl: mockUserInfo.schedulingUrl,
          },
        },
      },
    ]);

    const result = await connectCalendly(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('user@calendly.com');
      expect(result.data.provider).toBe('calendly');
    }
  });

  it('should return ALREADY_EXISTS when Calendly account is already connected', async () => {
    mockExchangeCodeForTokens.mockResolvedValueOnce(mockTokens);
    mockGetCurrentUser.mockResolvedValueOnce(mockUserInfo);
    mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce({
      id: 'existing_booking',
      provider: 'calendly',
      externalAccountId: mockUserInfo.uri,
    });

    await expectResult(connectCalendly(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.ALREADY_EXISTS);
        expect(error.message).toContain(mockUserInfo.email);
      }
    );
  });

  it('should return EXTERNAL_SERVICE_ERROR when token exchange fails', async () => {
    mockExchangeCodeForTokens.mockRejectedValueOnce(
      new Error('Failed to exchange code')
    );

    await expectResult(connectCalendly(mockDb as never, validInput)).toFailWith(
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
      connectCalendly(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing userId', async () => {
    const invalidInput = {
      organizationId: 'org_123',
      code: 'oauth_code_123',
    };

    await expectResult(
      connectCalendly(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return INTERNAL_ERROR on database failure', async () => {
    mockExchangeCodeForTokens.mockResolvedValueOnce(mockTokens);
    mockGetCurrentUser.mockResolvedValueOnce(mockUserInfo);
    mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce(null);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockRejectedValueOnce(new Error('Database error'));

    await expectResult(
      connectCalendly(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
