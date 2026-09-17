import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { getOrganization } from './get-organization.service.js';

describe('getOrganization', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  // Use valid UUID for id (schema requires UUID)
  const validInput = {
    id: '550e8400-e29b-41d4-a716-446655440000',
  };

  const existingOrg = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'My Salon',
    slug: 'my-salon',
    logo: null,
    businessType: 'salon',
    mainProduct: 'Hair styling',
    city: 'New York',
    country: 'us',
    minPrice: 50,
    maxPrice: 200,
    idealCustomerProfile: 'Young professionals',
    previousSuccesses: 'Featured in local magazine',
    metadata: null,
    createdAt: new Date(),
  };

  it('should return organization when found', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);

    const result = await getOrganization(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(validInput.id);
      expect(result.data.name).toBe('My Salon');
      expect(result.data.businessType).toBe('salon');
    }
  });

  it('should return NOT_FOUND when organization does not exist', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(null);

    await expectResult(getOrganization(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(error.message).toContain(validInput.id);
      }
    );
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    const invalidInput = {};

    await expectResult(
      getOrganization(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty id', async () => {
    const invalidInput = { id: '' };

    await expectResult(
      getOrganization(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.organization.findFirst.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    // tracked() re-throws errors, so expect a rejection
    await expect(getOrganization(mockDb as never, validInput)).rejects.toThrow(
      'Database connection failed'
    );
  });
});
