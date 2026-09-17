import {
  OutlookOAuthService,
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
import { connectOutlook } from './connect-outlook.service.js';

const outlookOAuthService = new OutlookOAuthService() as {
  exchangeCodeForTokens: ReturnType<typeof vi.fn>;
  getUserInfo: ReturnType<typeof vi.fn>;
};
const mockExchangeCodeForTokens = vi.mocked(
  outlookOAuthService.exchangeCodeForTokens
);
const mockGetUserInfo = vi.mocked(outlookOAuthService.getUserInfo);

describe('connectOutlook', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockExchangeCodeForTokens.mockReset();
    mockGetUserInfo.mockReset();
    vi.mocked(encryptCredentials).mockReturnValue('encrypted_credentials');
  });

  const validInput = {
    organizationId: 'org_123',
    code: 'oauth_code_123',
  };

  const mockTokens = {
    accessToken: 'access_token_123',
    refreshToken: 'refresh_token_123',
    tokenType: 'Bearer',
    expiresIn: 3600,
    scope: 'Mail.Send User.Read',
  };

  const mockUserInfo = {
    mail: 'user@outlook.com',
    displayName: 'Test User',
  };

  it('should connect Outlook account successfully', async () => {
    mockExchangeCodeForTokens.mockResolvedValueOnce(mockTokens);
    mockGetUserInfo.mockResolvedValueOnce(mockUserInfo);
    mockDb.query.emailAccount.findFirst.mockResolvedValueOnce(null);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'email_123',
        organizationId: 'org_123',
        provider: 'outlook',
        email: 'user@outlook.com',
        displayName: 'Test User',
        isActive: true,
      },
    ]);

    const result = await connectOutlook(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('user@outlook.com');
      expect(result.data.provider).toBe('outlook');
    }
    expect(mockExchangeCodeForTokens).toHaveBeenCalledWith('oauth_code_123');
  });

  it('should return ALREADY_EXISTS when email is already connected', async () => {
    mockExchangeCodeForTokens.mockResolvedValueOnce(mockTokens);
    mockGetUserInfo.mockResolvedValueOnce(mockUserInfo);
    mockDb.query.emailAccount.findFirst.mockResolvedValueOnce({
      id: 'existing_email',
      email: 'user@outlook.com',
    });

    await expectResult(connectOutlook(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.ALREADY_EXISTS);
        expect(error.message).toContain('user@outlook.com');
      }
    );
  });

  it('should return EXTERNAL_SERVICE_ERROR when token exchange fails', async () => {
    mockExchangeCodeForTokens.mockRejectedValueOnce(
      new Error('Failed to exchange code')
    );

    await expectResult(connectOutlook(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.EXTERNAL_SERVICE_ERROR);
      }
    );
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      code: 'oauth_code_123',
    };

    await expectResult(
      connectOutlook(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing code', async () => {
    const invalidInput = {
      organizationId: 'org_123',
    };

    await expectResult(
      connectOutlook(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return INTERNAL_ERROR on database failure', async () => {
    mockExchangeCodeForTokens.mockResolvedValueOnce(mockTokens);
    mockGetUserInfo.mockResolvedValueOnce(mockUserInfo);
    mockDb.query.emailAccount.findFirst.mockResolvedValueOnce(null);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockRejectedValueOnce(new Error('Database error'));

    await expectResult(
      connectOutlook(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
