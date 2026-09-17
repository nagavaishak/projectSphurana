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
import { getOffer } from './get-offer.service.js';

describe('getOffer', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'offer-1',
    organizationId: 'org-1',
  };

  const existingOffer = {
    id: 'offer-1',
    organizationId: 'org-1',
    name: 'Summer Sale',
    discountType: 'fixed_price',
    state: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('returns offer with serviceIds when found', async () => {
    mockDb.query.offer.findFirst.mockResolvedValueOnce({
      ...existingOffer,
      offerServices: [{ serviceId: 'service-1' }, { serviceId: 'service-2' }],
      offerLocations: [],
    });

    const result = await getOffer(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.offer.id).toBe('offer-1');
      expect(result.data.offer.name).toBe('Summer Sale');
      expect(result.data.serviceIds).toEqual(['service-1', 'service-2']);
    }
  });

  it('returns empty serviceIds when no services linked', async () => {
    mockDb.query.offer.findFirst.mockResolvedValueOnce({
      ...existingOffer,
      offerServices: [],
      offerLocations: [],
    });

    const result = await getOffer(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.offer.id).toBe('offer-1');
      expect(result.data.serviceIds).toEqual([]);
    }
  });

  it('returns NOT_FOUND when offer does not exist', async () => {
    mockDb.query.offer.findFirst.mockResolvedValueOnce(null);

    await expectResult(getOffer(mockDb as never, validInput)).toFailWithCode(
      ErrorCodes.NOT_FOUND
    );
  });

  it('returns VALIDATION_ERROR for missing id', async () => {
    await expectResult(
      getOffer(mockDb as never, { ...validInput, id: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
