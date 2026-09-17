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
import { completeStockTake } from './complete-stock-take.service.js';

describe('completeStockTake', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { id: 'st_1', organizationId: 'org_123' };

  it('writes counted quantities into product_stock and completes', async () => {
    mockDb.query.stockTake.findFirst.mockResolvedValueOnce({
      id: 'st_1',
      status: 'in_progress',
      locationId: 'loc_1',
    });
    mockDb.query.stockTakeItem.findMany.mockResolvedValueOnce([
      { id: 'sti_1', productId: 'prod_1', countedQuantity: 4 },
      { id: 'sti_2', productId: 'prod_2', countedQuantity: null },
    ]);
    mockDb.returning.mockResolvedValueOnce([
      { id: 'st_1', status: 'completed' },
    ]);

    await expectResult(
      completeStockTake(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.status).toBe('completed');
    });
    // Only the counted item triggers a stock upsert
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 'prod_1',
        locationId: 'loc_1',
        quantity: 4,
      })
    );
  });

  it('skips stock writes when the take has no location', async () => {
    mockDb.query.stockTake.findFirst.mockResolvedValueOnce({
      id: 'st_1',
      status: 'in_progress',
      locationId: null,
    });
    mockDb.query.stockTakeItem.findMany.mockResolvedValueOnce([
      { id: 'sti_1', productId: 'prod_1', countedQuantity: 4 },
    ]);
    mockDb.returning.mockResolvedValueOnce([
      { id: 'st_1', status: 'completed' },
    ]);

    await expectResult(
      completeStockTake(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.status).toBe('completed');
    });
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for an unknown stock take', async () => {
    mockDb.query.stockTake.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      completeStockTake(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns INVALID_STATE for an already completed stock take', async () => {
    mockDb.query.stockTake.findFirst.mockResolvedValueOnce({
      id: 'st_1',
      status: 'completed',
    });

    await expectResult(
      completeStockTake(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INVALID_STATE);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.stockTake.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      completeStockTake(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
