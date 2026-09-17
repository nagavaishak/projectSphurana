import {
  GoogleDriveOAuthService,
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

import { connectGoogleDrive } from './connect-google-drive.service.js';

const driveOAuthService = new GoogleDriveOAuthService() as {
  exchangeCodeForTokens: ReturnType<typeof vi.fn>;
  getUserInfo: ReturnType<typeof vi.fn>;
};
const mockExchangeCodeForTokens = vi.mocked(
  driveOAuthService.exchangeCodeForTokens
);
const mockGetUserInfo = vi.mocked(driveOAuthService.getUserInfo);
const mockEncryptCredentials = vi.mocked(encryptCredentials);

describe('connectGoogleDrive', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockEncryptCredentials.mockReturnValue('encrypted_credentials');
  });

  const validInput = {
    organizationId: 'org-123',
    userId: 'user-456',
    code: 'auth_code_abc',
  };

  const mockTokens = {
    accessToken: 'access_token_123',
    refreshToken: 'refresh_token_123',
    tokenType: 'Bearer',
    expiresIn: 3600,
    scope: 'drive.readonly',
  };

  const mockUserInfo = {
    email: 'user@gmail.com',
    name: 'Test User',
    picture: 'https://example.com/photo.jpg',
  };

  it('connects Google Drive successfully', async () => {
    mockExchangeCodeForTokens.mockResolvedValueOnce(mockTokens);
    mockGetUserInfo.mockResolvedValueOnce(mockUserInfo);
    mockDb.query.driveAccount.findFirst.mockResolvedValueOnce(null);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'drive-1',
        organizationId: 'org-123',
        email: 'user@gmail.com',
        isActive: true,
      },
    ]);

    const result = await connectGoogleDrive(mockDb as never, validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('user@gmail.com');
    }
    expect(mockExchangeCodeForTokens).toHaveBeenCalledWith('auth_code_abc');
  });

  it('returns ALREADY_EXISTS when account is already connected', async () => {
    mockExchangeCodeForTokens.mockResolvedValueOnce(mockTokens);
    mockGetUserInfo.mockResolvedValueOnce(mockUserInfo);
    mockDb.query.driveAccount.findFirst.mockResolvedValueOnce({
      id: 'existing-drive',
      organizationId: 'org-123',
      email: 'user@gmail.com',
    });

    await expectResult(
      connectGoogleDrive(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.ALREADY_EXISTS);
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      connectGoogleDrive(mockDb as never, { ...validInput, organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for missing userId', async () => {
    await expectResult(
      connectGoogleDrive(mockDb as never, { ...validInput, userId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for missing code', async () => {
    await expectResult(
      connectGoogleDrive(mockDb as never, { ...validInput, code: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns EXTERNAL_SERVICE_ERROR when token exchange fails', async () => {
    mockExchangeCodeForTokens.mockRejectedValueOnce(
      new Error('Failed to exchange code')
    );

    await expectResult(
      connectGoogleDrive(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.EXTERNAL_SERVICE_ERROR);
  });

  it('returns INTERNAL_ERROR on unexpected database failure', async () => {
    mockExchangeCodeForTokens.mockResolvedValueOnce(mockTokens);
    mockGetUserInfo.mockResolvedValueOnce(mockUserInfo);
    mockDb.query.driveAccount.findFirst.mockResolvedValueOnce(null);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockRejectedValueOnce(new Error('DB error'));

    await expectResult(
      connectGoogleDrive(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
