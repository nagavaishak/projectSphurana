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
import { createStockOrder } from './create-stock-order.service.js';

describe('createStockOrder', () => {
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
    organizationId: 'org_123',
    createdById: 'user_1',
    supplierId: 'sup_1',
    locationId: 'loc_1',
    items: [{ productId: 'prod_1', quantity: 10, unitCostCents: 500 }],
    fees: [{ name: 'Shipping', type: 'currency' as const, value: 1000 }],
  };

  it('creates an order with items and fees', async () => {
    mockDb.query.product.findMany.mockResolvedValueOnce([{ id: 'prod_1' }]);
    const mockOrder = { id: 'so_1', status: 'draft' };
    const mockItems = [{ id: 'soi_1', productId: 'prod_1', quantity: 10 }];
    const mockFees = [{ id: 'sof_1', name: 'Shipping' }];
    mockDb.returning
      .mockResolvedValueOnce([mockOrder])
      .mockResolvedValueOnce(mockItems)
      .mockResolvedValueOnce(mockFees);

    await expectResult(
      createStockOrder(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.id).toBe('so_1');
      expect(data.items).toHaveLength(1);
      expect(data.fees).toHaveLength(1);
    });
  });

  it('creates an order without fees', async () => {
    mockDb.query.product.findMany.mockResolvedValueOnce([{ id: 'prod_1' }]);
    mockDb.returning
      .mockResolvedValueOnce([{ id: 'so_1' }])
      .mockResolvedValueOnce([{ id: 'soi_1' }]);

    await expectResult(
      createStockOrder(mockDb as never, { ...validInput, fees: [] })
    ).toSucceedWith((data) => {
      expect(data.fees).toHaveLength(0);
    });
    // order + items only — no fee insert
    expect(mockDb.insert).toHaveBeenCalledTimes(2);
  });

  it('returns NOT_FOUND when a product is not in the org', async () => {
    mockDb.query.product.findMany.mockResolvedValueOnce([]);

    await expectResult(
      createStockOrder(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for empty items', async () => {
    await expectResult(
      createStockOrder(mockDb as never, { ...validInput, items: [] })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for non-integer fee value', async () => {
    await expectResult(
      createStockOrder(mockDb as never, {
        ...validInput,
        fees: [{ name: 'VAT', type: 'percent' as const, value: 2.5 }],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.product.findMany.mockResolvedValueOnce([{ id: 'prod_1' }]);
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      createStockOrder(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
