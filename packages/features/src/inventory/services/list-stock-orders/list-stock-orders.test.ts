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
import { listStockOrders } from './list-stock-orders.service.js';

describe('listStockOrders', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { organizationId: 'org_123' };

  it('lists stock orders with pagination', async () => {
    mockDb.query.stockOrder.findMany.mockResolvedValueOnce([
      { id: 'so_1', status: 'draft' },
    ]);
    mockDb.from.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([{ total: 1 }]);

    await expectResult(
      listStockOrders(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.items).toHaveLength(1);
      expect(data.total).toBe(1);
      expect(data.limit).toBe(50);
    });
  });

  it('returns VALIDATION_ERROR for invalid status', async () => {
    await expectResult(
      listStockOrders(mockDb as never, {
        ...validInput,
        status: 'bogus' as never,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.stockOrder.findMany.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      listStockOrders(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
