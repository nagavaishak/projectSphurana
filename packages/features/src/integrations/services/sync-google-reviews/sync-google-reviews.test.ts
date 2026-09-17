import {
  GoogleMyBusinessOAuthService,
  decryptCredentials,
  starRatingToNumber,
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
import { syncGoogleReviews } from './sync-google-reviews.service.js';

const gmbOAuthService = new GoogleMyBusinessOAuthService() as {
  refreshAccessToken: ReturnType<typeof vi.fn>;
  getReviews: ReturnType<typeof vi.fn>;
};
const mockRefreshAccessToken = vi.mocked(gmbOAuthService.refreshAccessToken);
const mockGetReviews = vi.mocked(gmbOAuthService.getReviews);

describe('syncGoogleReviews', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockRefreshAccessToken.mockReset();
    mockGetReviews.mockReset();
    vi.mocked(decryptCredentials).mockReturnValue({
      accessToken: 'decrypted_access_token',
      refreshToken: 'decrypted_refresh_token',
    } as never);
    vi.mocked(starRatingToNumber).mockImplementation((rating: string) => {
      const map: Record<string, number> = {
        ONE: 1,
        TWO: 2,
        THREE: 3,
        FOUR: 4,
        FIVE: 5,
      };
      return map[rating] || 0;
    });
  });

  const validInput = {
    organizationId: 'org_123',
    accountId: 'gmb_123',
  };

  const mockAccount = {
    id: 'gmb_123',
    organizationId: 'org_123',
    accountName: 'accounts/123456',
    locationId: 'locations/456789',
    encryptedCredentials: 'encrypted_creds',
  };

  const mockReviewsResponse = {
    reviews: [
      {
        name: 'accounts/123/locations/456/reviews/789',
        reviewId: 'review_789',
        reviewer: {
          displayName: 'John Doe',
          profilePhotoUrl: 'https://photo.url',
        },
        starRating: 'FIVE' as const,
        comment: 'Great service!',
        createTime: '2024-01-15T12:00:00Z',
        updateTime: '2024-01-15T12:00:00Z',
      },
    ],
    totalReviewCount: 42,
    averageRating: 4.5,
  };

  it('should sync reviews successfully', async () => {
    mockDb.query.googleMyBusinessAccount.findFirst.mockResolvedValueOnce(
      mockAccount
    );
    mockRefreshAccessToken.mockResolvedValueOnce({
      accessToken: 'new_access_token',
    });
    mockGetReviews.mockResolvedValueOnce(mockReviewsResponse);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.onConflictDoUpdate.mockReturnThis();
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();

    const result = await syncGoogleReviews(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.synced).toBe(1);
      expect(result.data.averageRating).toBe(4.5);
      expect(result.data.totalReviews).toBe(42);
    }
  });

  it('should return NOT_FOUND when account does not exist', async () => {
    mockDb.query.googleMyBusinessAccount.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      syncGoogleReviews(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return EXTERNAL_SERVICE_ERROR when reviews API fails', async () => {
    mockDb.query.googleMyBusinessAccount.findFirst.mockResolvedValueOnce(
      mockAccount
    );
    mockRefreshAccessToken.mockResolvedValueOnce({
      accessToken: 'new_access_token',
    });
    mockGetReviews.mockRejectedValueOnce(
      new Error('Failed to get reviews: Unauthorized')
    );

    await expectResult(
      syncGoogleReviews(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.EXTERNAL_SERVICE_ERROR);
    });
  });

  it('should return VALIDATION_ERROR for missing accountId', async () => {
    const invalidInput = { organizationId: 'org_123' };

    await expectResult(
      syncGoogleReviews(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
