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
import { getGoogleReviewLink } from './get-google-review-link.service.js';

describe('getGoogleReviewLink', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    accountId: 'gmb_123',
  };

  it('should return review link successfully', async () => {
    mockDb.query.googleMyBusinessAccount.findFirst.mockResolvedValueOnce({
      reviewLink:
        'https://search.google.com/local/writereview?placeid=ChIJ_place_id',
      locationName: 'My Business',
      placeId: 'ChIJ_place_id',
      averageRating: '4.5',
      totalReviews: 42,
    });

    const result = await getGoogleReviewLink(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reviewLink).toContain('ChIJ_place_id');
      expect(result.data.locationName).toBe('My Business');
      expect(result.data.averageRating).toBe('4.5');
      expect(result.data.totalReviews).toBe(42);
    }
  });

  it('should return NOT_FOUND when account does not exist', async () => {
    mockDb.query.googleMyBusinessAccount.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getGoogleReviewLink(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return VALIDATION_ERROR for missing accountId', async () => {
    const invalidInput = { organizationId: 'org_123' };

    await expectResult(
      getGoogleReviewLink(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
