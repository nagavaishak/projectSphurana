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
import { cancelStockOrder } from './cancel-stock-order.service.js';

describe('cancelStockOrder', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { id: 'so_1', organizationId: 'org_123' };

  it('cancels a draft order', async () => {
    mockDb.query.stockOrder.findFirst.mockResolvedValueOnce({
      id: 'so_1',
      status: 'draft',
    });
    mockDb.returning.mockResolvedValueOnce([
      { id: 'so_1', status: 'cancelled' },
    ]);

    await expectResult(
      cancelStockOrder(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.status).toBe('cancelled');
    });
  });

  it('returns NOT_FOUND when the order does not exist', async () => {
    mockDb.query.stockOrder.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      cancelStockOrder(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns INVALID_STATE for a received order', async () => {
    mockDb.query.stockOrder.findFirst.mockResolvedValueOnce({
      id: 'so_1',
      status: 'received',
    });

    await expectResult(
      cancelStockOrder(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INVALID_STATE);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.stockOrder.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      cancelStockOrder(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
