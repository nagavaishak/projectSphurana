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
import { recordStockTakeCounts } from './record-stock-take-counts.service.js';

describe('recordStockTakeCounts', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    stockTakeId: 'st_1',
    organizationId: 'org_123',
    items: [{ itemId: 'sti_1', countedQuantity: 6 }],
  };

  it('records counted quantities', async () => {
    mockDb.query.stockTake.findFirst.mockResolvedValueOnce({
      id: 'st_1',
      status: 'in_progress',
    });
    mockDb.returning.mockResolvedValueOnce([
      { id: 'sti_1', countedQuantity: 6 },
    ]);
    mockDb.query.stockTakeItem.findMany.mockResolvedValueOnce([
      { id: 'sti_1', countedQuantity: 6 },
    ]);

    await expectResult(
      recordStockTakeCounts(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.items[0].countedQuantity).toBe(6);
    });
    expect(mockDb.set).toHaveBeenCalledWith({ countedQuantity: 6 });
  });

  it('returns NOT_FOUND for an unknown stock take', async () => {
    mockDb.query.stockTake.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      recordStockTakeCounts(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns NOT_FOUND for an unknown item', async () => {
    mockDb.query.stockTake.findFirst.mockResolvedValueOnce({
      id: 'st_1',
      status: 'in_progress',
    });
    mockDb.returning.mockResolvedValueOnce([]);

    await expectResult(
      recordStockTakeCounts(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns INVALID_STATE for a completed stock take', async () => {
    mockDb.query.stockTake.findFirst.mockResolvedValueOnce({
      id: 'st_1',
      status: 'completed',
    });

    await expectResult(
      recordStockTakeCounts(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INVALID_STATE);
  });

  it('returns VALIDATION_ERROR for negative counted quantity', async () => {
    await expectResult(
      recordStockTakeCounts(mockDb as never, {
        ...validInput,
        items: [{ itemId: 'sti_1', countedQuantity: -1 }],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.stockTake.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      recordStockTakeCounts(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
