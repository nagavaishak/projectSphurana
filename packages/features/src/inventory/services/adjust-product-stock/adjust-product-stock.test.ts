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
import { adjustProductStock } from './adjust-product-stock.service.js';

describe('adjustProductStock', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // Location ownership check passes by default; overridden per-test.
    mockDb.query.organizationLocation.findFirst.mockResolvedValue({
      id: 'loc_1',
    });
  });

  const validInput = {
    productId: 'prod_1',
    locationId: 'loc_1',
    organizationId: 'org_123',
    quantity: 7,
  };

  const owner = {
    id: 'prod_1',
    trackStock: true,
    lowStockNotify: true,
    lowStockLevel: 3,
  };

  it('upserts the stock row with the absolute quantity', async () => {
    mockDb.query.product.findFirst.mockResolvedValueOnce(owner);
    const mockRow = {
      id: 'ps_1',
      productId: 'prod_1',
      locationId: 'loc_1',
      quantity: 7,
    };
    mockDb.returning.mockResolvedValueOnce([mockRow]);

    await expectResult(
      adjustProductStock(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data).toEqual(mockRow);
    });
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.onConflictDoUpdate).toHaveBeenCalled();
  });

  it('succeeds when quantity drops to or below the low stock level', async () => {
    mockDb.query.product.findFirst.mockResolvedValueOnce(owner);
    mockDb.returning.mockResolvedValueOnce([
      { id: 'ps_1', productId: 'prod_1', locationId: 'loc_1', quantity: 2 },
    ]);

    await expectResult(
      adjustProductStock(mockDb as never, { ...validInput, quantity: 2 })
    ).toSucceedWith((data) => {
      expect(data.quantity).toBe(2);
    });
  });

  it('returns NOT_FOUND when product does not belong to org', async () => {
    mockDb.query.product.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      adjustProductStock(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the location does not belong to the org', async () => {
    mockDb.query.product.findFirst.mockResolvedValueOnce(owner);
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      adjustProductStock(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for negative quantity', async () => {
    await expectResult(
      adjustProductStock(mockDb as never, { ...validInput, quantity: -1 })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.product.findFirst.mockResolvedValueOnce(owner);
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      adjustProductStock(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
