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
import { listOffers } from './list-offers.service.js';

describe('listOffers', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org-1',
  };

  it('returns items with serviceIds', async () => {
    const mockOffers = [
      {
        id: 'offer-1',
        organizationId: 'org-1',
        name: 'Summer Sale',
        discountType: 'fixed_price',
        state: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
        offerServices: [{ serviceId: 'service-1' }],
        offerLocations: [],
      },
      {
        id: 'offer-2',
        organizationId: 'org-1',
        name: 'BOGO Deal',
        discountType: 'buy_x_get_y',
        state: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
        offerServices: [],
        offerLocations: [{ locationId: 'location-1' }],
      },
    ];

    // First findMany returns results with relations
    mockDb.query.offer.findMany.mockResolvedValueOnce(mockOffers);
    // Second findMany returns all matching records for count
    mockDb.query.offer.findMany.mockResolvedValueOnce([
      { id: 'offer-1' },
      { id: 'offer-2' },
    ]);

    const result = await listOffers(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
      expect(result.data.items[0].id).toBe('offer-1');
      expect(result.data.items[0].serviceIds).toEqual(['service-1']);
      expect(result.data.items[1].id).toBe('offer-2');
      expect(result.data.items[1].serviceIds).toEqual([]);
      expect(result.data.total).toBe(2);
    }
  });

  it('returns empty list when no offers exist', async () => {
    mockDb.query.offer.findMany.mockResolvedValueOnce([]);
    mockDb.query.offer.findMany.mockResolvedValueOnce([]);

    const result = await listOffers(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toEqual([]);
      expect(result.data.total).toBe(0);
    }
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      listOffers(mockDb as never, { organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
