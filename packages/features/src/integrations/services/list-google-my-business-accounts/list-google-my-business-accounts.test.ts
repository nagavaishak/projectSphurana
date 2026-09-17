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
import { listGoogleMyBusinessAccounts } from './list-google-my-business-accounts.service.js';

describe('listGoogleMyBusinessAccounts', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { organizationId: 'org_123' };

  it('should list accounts successfully', async () => {
    const mockAccounts = [
      {
        id: 'gmb_1',
        googleAccountEmail: 'owner@gmail.com',
        locationName: 'My Business',
        placeId: 'ChIJ_place_id',
        reviewLink:
          'https://search.google.com/local/writereview?placeid=ChIJ_place_id',
        averageRating: '4.5',
        totalReviews: 42,
        isActive: true,
        createdAt: new Date(),
      },
    ];

    mockDb.query.googleMyBusinessAccount.findMany.mockResolvedValueOnce(
      mockAccounts
    );

    const result = await listGoogleMyBusinessAccounts(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].locationName).toBe('My Business');
    }
  });

  it('should return empty array when no accounts', async () => {
    mockDb.query.googleMyBusinessAccount.findMany.mockResolvedValueOnce([]);

    const result = await listGoogleMyBusinessAccounts(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(0);
    }
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      listGoogleMyBusinessAccounts(mockDb as never, {} as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return INTERNAL_ERROR on database failure', async () => {
    mockDb.query.googleMyBusinessAccount.findMany.mockRejectedValueOnce(
      new Error('Database error')
    );

    await expectResult(
      listGoogleMyBusinessAccounts(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
