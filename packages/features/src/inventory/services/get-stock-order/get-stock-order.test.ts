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
import { getStockOrder } from './get-stock-order.service.js';

describe('getStockOrder', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { id: 'so_1', organizationId: 'org_123' };

  it('returns order with items and fees', async () => {
    const mockOrder = { id: 'so_1', items: [{ id: 'soi_1' }], fees: [] };
    mockDb.query.stockOrder.findFirst.mockResolvedValueOnce(mockOrder);

    await expectResult(
      getStockOrder(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.items).toHaveLength(1);
    });
  });

  it('returns NOT_FOUND when missing', async () => {
    mockDb.query.stockOrder.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getStockOrder(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for missing id', async () => {
    await expectResult(
      getStockOrder(mockDb as never, { ...validInput, id: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.stockOrder.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      getStockOrder(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
