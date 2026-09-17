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
import { updateStockOrder } from './update-stock-order.service.js';

describe('updateStockOrder', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'so_1',
    organizationId: 'org_123',
    notes: 'Updated notes',
  };

  it('updates header fields on a draft order', async () => {
    mockDb.query.stockOrder.findFirst.mockResolvedValueOnce({
      id: 'so_1',
      status: 'draft',
    });
    mockDb.returning.mockResolvedValueOnce([
      { id: 'so_1', status: 'draft', notes: 'Updated notes' },
    ]);
    mockDb.query.stockOrderItem.findMany.mockResolvedValueOnce([]);
    mockDb.query.stockOrderFee.findMany.mockResolvedValueOnce([]);

    await expectResult(
      updateStockOrder(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.notes).toBe('Updated notes');
    });
  });

  it('marks a draft as ordered', async () => {
    mockDb.query.stockOrder.findFirst.mockResolvedValueOnce({
      id: 'so_1',
      status: 'draft',
    });
    mockDb.returning.mockResolvedValueOnce([{ id: 'so_1', status: 'ordered' }]);
    mockDb.query.stockOrderItem.findMany.mockResolvedValueOnce([]);
    mockDb.query.stockOrderFee.findMany.mockResolvedValueOnce([]);

    await expectResult(
      updateStockOrder(mockDb as never, {
        id: 'so_1',
        organizationId: 'org_123',
        status: 'ordered',
      })
    ).toSucceedWith((data) => {
      expect(data.status).toBe('ordered');
    });
  });

  it('returns NOT_FOUND when the order does not exist', async () => {
    mockDb.query.stockOrder.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      updateStockOrder(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns INVALID_STATE for a received order', async () => {
    mockDb.query.stockOrder.findFirst.mockResolvedValueOnce({
      id: 'so_1',
      status: 'received',
    });

    await expectResult(
      updateStockOrder(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INVALID_STATE);
  });

  it('rejects item replacement when order is not a draft', async () => {
    mockDb.query.stockOrder.findFirst.mockResolvedValueOnce({
      id: 'so_1',
      status: 'ordered',
    });

    await expectResult(
      updateStockOrder(mockDb as never, {
        ...validInput,
        items: [{ productId: 'prod_1', quantity: 1, unitCostCents: 0 }],
      })
    ).toFailWithCode(ErrorCodes.INVALID_STATE);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.stockOrder.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      updateStockOrder(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
