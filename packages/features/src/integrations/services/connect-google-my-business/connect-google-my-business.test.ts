import {
  GoogleMyBusinessOAuthService,
  buildReviewLink,
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

import { connectGoogleMyBusiness } from './connect-google-my-business.service.js';

const gmbOAuthService = new GoogleMyBusinessOAuthService() as {
  exchangeCodeForTokens: ReturnType<typeof vi.fn>;
  getUserInfo: ReturnType<typeof vi.fn>;
  getLocations: ReturnType<typeof vi.fn>;
};
const mockExchangeCodeForTokens = vi.mocked(
  gmbOAuthService.exchangeCodeForTokens
);
const mockGetUserInfo = vi.mocked(gmbOAuthService.getUserInfo);
const mockGetLocations = vi.mocked(gmbOAuthService.getLocations);
const mockEncryptCredentials = vi.mocked(encryptCredentials);
const mockBuildReviewLink = vi.mocked(buildReviewLink);

describe('connectGoogleMyBusiness', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockEncryptCredentials.mockReturnValue('encrypted_credentials');
    mockBuildReviewLink.mockImplementation(
      (placeId: string) =>
        `https://search.google.com/local/writereview?placeid=${placeId}`
    );
  });

  const validInput = {
    organizationId: 'org_123',
    userId: 'user_123',
    code: 'oauth_code_123',
    locationId: 'locations/456789',
    accountName: 'accounts/123456',
  };

  const mockTokens = {
    accessToken: 'access_token_123',
    refreshToken: 'refresh_token_123',
    tokenType: 'Bearer',
    expiresIn: 3600,
    scope: 'https://www.googleapis.com/auth/business.manage',
  };

  const mockUserInfo = {
    id: 'google_123',
    email: 'owner@gmail.com',
    name: 'Business Owner',
    verifiedEmail: true,
  };

  const mockLocations = [
    {
      name: 'locations/456789',
      title: 'My Business',
      placeId: 'ChIJ_place_id',
      websiteUri: 'https://mybusiness.com',
    },
  ];

  it('should connect GMB account successfully', async () => {
    mockExchangeCodeForTokens.mockResolvedValueOnce(mockTokens);
    mockGetUserInfo.mockResolvedValueOnce(mockUserInfo);
    mockGetLocations.mockResolvedValueOnce(mockLocations);
    mockDb.query.googleMyBusinessAccount.findFirst.mockResolvedValueOnce(null);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'gmb_123',
        organizationId: 'org_123',
        googleAccountEmail: 'owner@gmail.com',
        locationName: 'My Business',
        placeId: 'ChIJ_place_id',
        reviewLink:
          'https://search.google.com/local/writereview?placeid=ChIJ_place_id',
        isActive: true,
      },
    ]);

    const result = await connectGoogleMyBusiness(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.locationName).toBe('My Business');
      expect(result.data.placeId).toBe('ChIJ_place_id');
    }
    expect(mockExchangeCodeForTokens).toHaveBeenCalledWith('oauth_code_123');
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('should return ALREADY_EXISTS when location is already connected', async () => {
    mockExchangeCodeForTokens.mockResolvedValueOnce(mockTokens);
    mockGetUserInfo.mockResolvedValueOnce(mockUserInfo);
    mockGetLocations.mockResolvedValueOnce(mockLocations);
    mockDb.query.googleMyBusinessAccount.findFirst.mockResolvedValueOnce({
      id: 'existing_gmb',
      locationId: 'locations/456789',
    });

    await expectResult(
      connectGoogleMyBusiness(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.ALREADY_EXISTS);
      expect(error.message).toContain('My Business');
    });
  });

  it('should return NOT_FOUND when location does not exist', async () => {
    mockExchangeCodeForTokens.mockResolvedValueOnce(mockTokens);
    mockGetUserInfo.mockResolvedValueOnce(mockUserInfo);
    mockGetLocations.mockResolvedValueOnce([]); // No locations

    await expectResult(
      connectGoogleMyBusiness(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return EXTERNAL_SERVICE_ERROR when token exchange fails', async () => {
    mockExchangeCodeForTokens.mockRejectedValueOnce(
      new Error('Failed to exchange code')
    );

    await expectResult(
      connectGoogleMyBusiness(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.EXTERNAL_SERVICE_ERROR);
    });
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      userId: 'user_123',
      code: 'oauth_code_123',
      locationId: 'locations/456789',
      accountName: 'accounts/123456',
    };

    await expectResult(
      connectGoogleMyBusiness(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return INTERNAL_ERROR on database failure', async () => {
    mockExchangeCodeForTokens.mockResolvedValueOnce(mockTokens);
    mockGetUserInfo.mockResolvedValueOnce(mockUserInfo);
    mockGetLocations.mockResolvedValueOnce(mockLocations);
    mockDb.query.googleMyBusinessAccount.findFirst.mockResolvedValueOnce(null);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.returning.mockRejectedValueOnce(new Error('Database error'));

    await expectResult(
      connectGoogleMyBusiness(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
