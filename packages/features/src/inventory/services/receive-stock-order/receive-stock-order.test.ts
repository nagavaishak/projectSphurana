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
import { receiveStockOrder } from './receive-stock-order.service.js';

describe('receiveStockOrder', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const baseOrder = {
    id: 'so_1',
    organizationId: 'org_123',
    status: 'ordered',
    locationId: 'loc_1',
    items: [
      {
        id: 'soi_1',
        stockOrderId: 'so_1',
        productId: 'prod_1',
        quantity: 10,
        receivedQuantity: 0,
      },
    ],
  };

  const validInput = {
    stockOrderId: 'so_1',
    organizationId: 'org_123',
    items: [{ itemId: 'soi_1', receivedQuantity: 10 }],
  };

  it('marks the order received when all quantities arrive', async () => {
    mockDb.query.stockOrder.findFirst.mockResolvedValueOnce(baseOrder);
    mockDb.returning.mockResolvedValueOnce([
      { id: 'so_1', status: 'received' },
    ]);
    mockDb.query.stockOrderFee.findMany.mockResolvedValueOnce([]);

    await expectResult(
      receiveStockOrder(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.status).toBe('received');
      expect(data.items[0].receivedQuantity).toBe(10);
    });
    // stock increment upsert happened
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.onConflictDoUpdate).toHaveBeenCalled();
  });

  it('rejects a receipt that exceeds the ordered quantity', async () => {
    mockDb.query.stockOrder.findFirst.mockResolvedValueOnce(baseOrder);

    await expectResult(
      receiveStockOrder(mockDb as never, {
        ...validInput,
        items: [{ itemId: 'soi_1', receivedQuantity: 11 }], // ordered was 10
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('marks the order partially_received for a partial delivery', async () => {
    mockDb.query.stockOrder.findFirst.mockResolvedValueOnce(baseOrder);
    mockDb.returning.mockResolvedValueOnce([
      { id: 'so_1', status: 'partially_received' },
    ]);
    mockDb.query.stockOrderFee.findMany.mockResolvedValueOnce([]);

    await expectResult(
      receiveStockOrder(mockDb as never, {
        ...validInput,
        items: [{ itemId: 'soi_1', receivedQuantity: 4 }],
      })
    ).toSucceedWith((data) => {
      expect(data.status).toBe('partially_received');
      expect(data.items[0].receivedQuantity).toBe(4);
    });
  });

  it('returns NOT_FOUND for an unknown order', async () => {
    mockDb.query.stockOrder.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      receiveStockOrder(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns NOT_FOUND for an unknown order item', async () => {
    mockDb.query.stockOrder.findFirst.mockResolvedValueOnce(baseOrder);

    await expectResult(
      receiveStockOrder(mockDb as never, {
        ...validInput,
        items: [{ itemId: 'soi_missing', receivedQuantity: 1 }],
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns INVALID_STATE for a cancelled order', async () => {
    mockDb.query.stockOrder.findFirst.mockResolvedValueOnce({
      ...baseOrder,
      status: 'cancelled',
    });

    await expectResult(
      receiveStockOrder(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INVALID_STATE);
  });

  it('returns INVALID_STATE when the order has no location', async () => {
    mockDb.query.stockOrder.findFirst.mockResolvedValueOnce({
      ...baseOrder,
      locationId: null,
    });

    await expectResult(
      receiveStockOrder(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INVALID_STATE);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.stockOrder.findFirst.mockResolvedValueOnce(baseOrder);
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      receiveStockOrder(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
