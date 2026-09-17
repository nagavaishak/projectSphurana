import {
  InstagramOAuthService,
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
import { connectInstagram } from './connect-instagram.service.js';

const instagramOAuthService = new InstagramOAuthService() as {
  exchangeCodeForToken: ReturnType<typeof vi.fn>;
  exchangeForLongLivedToken: ReturnType<typeof vi.fn>;
  getUserProfile: ReturnType<typeof vi.fn>;
};
const mocks = {
  mockExchangeCodeForToken: vi.mocked(
    instagramOAuthService.exchangeCodeForToken
  ),
  mockExchangeForLongLivedToken: vi.mocked(
    instagramOAuthService.exchangeForLongLivedToken
  ),
  mockGetUserProfile: vi.mocked(instagramOAuthService.getUserProfile),
  mockEncryptCredentials: vi.mocked(encryptCredentials),
};

describe('connectInstagram', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    userId: 'user_123',
    code: 'oauth_code_123',
  };

  const mockShortLived = { accessToken: 'short_token', tokenType: 'bearer' };
  const mockLongLived = {
    accessToken: 'long_token',
    tokenType: 'bearer',
    expiresIn: 5184000,
  };
  const mockProfile = {
    id: 'ig_user_123',
    username: 'testbusiness',
    name: 'Test Business',
    profile_picture_url: 'https://example.com/pic.jpg',
    account_type: 'BUSINESS',
  };

  it('should connect Instagram for new integration', async () => {
    mocks.mockExchangeCodeForToken.mockResolvedValueOnce(mockShortLived);
    mocks.mockExchangeForLongLivedToken.mockResolvedValueOnce(mockLongLived);
    mocks.mockGetUserProfile.mockResolvedValueOnce(mockProfile);
    mocks.mockEncryptCredentials.mockReturnValueOnce('encrypted_data');
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce(null);

    const mockResult = {
      id: 'ig_int_1',
      organizationId: 'org_123',
      username: 'testbusiness',
      isActive: true,
    };
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([mockResult]);

    const result = await connectInstagram(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.username).toBe('testbusiness');
    }
    expect(mocks.mockExchangeCodeForToken).toHaveBeenCalledWith(
      'oauth_code_123'
    );
    expect(mocks.mockExchangeForLongLivedToken).toHaveBeenCalledWith(
      'short_token'
    );
  });

  it('should update existing integration', async () => {
    mocks.mockExchangeCodeForToken.mockResolvedValueOnce(mockShortLived);
    mocks.mockExchangeForLongLivedToken.mockResolvedValueOnce(mockLongLived);
    mocks.mockGetUserProfile.mockResolvedValueOnce(mockProfile);
    mocks.mockEncryptCredentials.mockReturnValueOnce('encrypted_data');
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce({
      id: 'existing_ig',
      organizationId: 'org_123',
    });

    const mockUpdated = {
      id: 'existing_ig',
      organizationId: 'org_123',
      username: 'testbusiness',
      isActive: true,
    };
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([mockUpdated]);

    const result = await connectInstagram(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('existing_ig');
    }
  });

  it('should return VALIDATION_ERROR for missing code', async () => {
    await expectResult(
      connectInstagram(mockDb as never, { ...validInput, code: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      connectInstagram(mockDb as never, { ...validInput, organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return INTERNAL_ERROR when OAuth exchange fails', async () => {
    mocks.mockExchangeCodeForToken.mockRejectedValueOnce(
      new Error('OAuth failed')
    );

    await expectResult(
      connectInstagram(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });

  it('should return INTERNAL_ERROR on database failure', async () => {
    mocks.mockExchangeCodeForToken.mockResolvedValueOnce(mockShortLived);
    mocks.mockExchangeForLongLivedToken.mockResolvedValueOnce(mockLongLived);
    mocks.mockGetUserProfile.mockResolvedValueOnce(mockProfile);
    mocks.mockEncryptCredentials.mockReturnValueOnce('encrypted_data');
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce(null);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockRejectedValueOnce(new Error('DB error'));

    await expectResult(
      connectInstagram(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
