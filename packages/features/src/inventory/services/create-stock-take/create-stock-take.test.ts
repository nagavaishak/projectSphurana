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
import { createStockTake } from './create-stock-take.service.js';

describe('createStockTake', () => {
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
    locationId: 'loc_1',
    productIds: ['prod_1', 'prod_2'],
  };

  it('creates a stock take snapshotting expected quantities', async () => {
    mockDb.query.product.findMany.mockResolvedValueOnce([
      { id: 'prod_1' },
      { id: 'prod_2' },
    ]);
    mockDb.query.productStock.findMany.mockResolvedValueOnce([
      { productId: 'prod_1', locationId: 'loc_1', quantity: 8 },
    ]);
    const mockTake = { id: 'st_1', status: 'in_progress' };
    mockDb.returning.mockResolvedValueOnce([mockTake]).mockResolvedValueOnce([
      { id: 'sti_1', productId: 'prod_1', expectedQuantity: 8 },
      { id: 'sti_2', productId: 'prod_2', expectedQuantity: 0 },
    ]);

    await expectResult(
      createStockTake(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.id).toBe('st_1');
      expect(data.items).toHaveLength(2);
    });
    // Items inserted with snapshot quantities (8 for prod_1, 0 for prod_2)
    expect(mockDb.values).toHaveBeenCalledWith([
      expect.objectContaining({ productId: 'prod_1', expectedQuantity: 8 }),
      expect.objectContaining({ productId: 'prod_2', expectedQuantity: 0 }),
    ]);
  });

  it('defaults to all active tracked products when productIds omitted', async () => {
    mockDb.query.product.findMany.mockResolvedValueOnce([{ id: 'prod_1' }]);
    mockDb.query.productStock.findMany.mockResolvedValueOnce([]);
    mockDb.returning
      .mockResolvedValueOnce([{ id: 'st_1' }])
      .mockResolvedValueOnce([{ id: 'sti_1' }]);

    const { productIds: _ids, ...input } = validInput;

    await expectResult(createStockTake(mockDb as never, input)).toSucceedWith(
      (data) => {
        expect(data.items).toHaveLength(1);
      }
    );
  });

  it('returns NOT_FOUND when a product is not in the org', async () => {
    mockDb.query.product.findMany.mockResolvedValueOnce([{ id: 'prod_1' }]);

    await expectResult(
      createStockTake(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns INVALID_STATE when no products are available', async () => {
    mockDb.query.product.findMany.mockResolvedValueOnce([]);

    const { productIds: _ids, ...input } = validInput;

    await expectResult(createStockTake(mockDb as never, input)).toFailWithCode(
      ErrorCodes.INVALID_STATE
    );
  });

  it('returns VALIDATION_ERROR for missing locationId', async () => {
    await expectResult(
      createStockTake(mockDb as never, { ...validInput, locationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.product.findMany.mockResolvedValueOnce([
      { id: 'prod_1' },
      { id: 'prod_2' },
    ]);
    mockDb.query.productStock.findMany.mockResolvedValueOnce([]);
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      createStockTake(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
