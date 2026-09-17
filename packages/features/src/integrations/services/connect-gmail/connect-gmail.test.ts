import {
  GmailOAuthService,
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

import { connectGmail } from './connect-gmail.service.js';

const gmailOAuthService = new GmailOAuthService() as {
  exchangeCodeForTokens: ReturnType<typeof vi.fn>;
  getUserInfo: ReturnType<typeof vi.fn>;
};
const mockExchangeCodeForTokens = vi.mocked(
  gmailOAuthService.exchangeCodeForTokens
);
const mockGetUserInfo = vi.mocked(gmailOAuthService.getUserInfo);
const mockEncryptCredentials = vi.mocked(encryptCredentials);

describe('connectGmail', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockEncryptCredentials.mockReturnValue('encrypted_credentials');
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
    scope: 'https://www.googleapis.com/auth/gmail.send',
  };

  const mockUserInfo = {
    email: 'user@gmail.com',
    name: 'Test User',
  };

  it('should connect Gmail account successfully', async () => {
    mockExchangeCodeForTokens.mockResolvedValueOnce(mockTokens);
    mockGetUserInfo.mockResolvedValueOnce(mockUserInfo);
    mockDb.query.emailAccount.findFirst.mockResolvedValueOnce(null);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'email_123',
        organizationId: 'org_123',
        provider: 'gmail',
        email: 'user@gmail.com',
        displayName: 'Test User',
        isActive: true,
      },
    ]);

    const result = await connectGmail(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('user@gmail.com');
      expect(result.data.provider).toBe('gmail');
    }
    expect(mockExchangeCodeForTokens).toHaveBeenCalledWith('oauth_code_123');
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('should return ALREADY_EXISTS when email is already connected', async () => {
    mockExchangeCodeForTokens.mockResolvedValueOnce(mockTokens);
    mockGetUserInfo.mockResolvedValueOnce(mockUserInfo);
    mockDb.query.emailAccount.findFirst.mockResolvedValueOnce({
      id: 'existing_email',
      email: 'user@gmail.com',
    });

    await expectResult(connectGmail(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.ALREADY_EXISTS);
        expect(error.message).toContain('user@gmail.com');
      }
    );
  });

  it('should return EXTERNAL_SERVICE_ERROR when token exchange fails', async () => {
    mockExchangeCodeForTokens.mockRejectedValueOnce(
      new Error('Failed to exchange code')
    );

    await expectResult(connectGmail(mockDb as never, validInput)).toFailWith(
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
      connectGmail(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing code', async () => {
    const invalidInput = {
      organizationId: 'org_123',
    };

    await expectResult(
      connectGmail(mockDb as never, invalidInput as never)
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
      connectGmail(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
