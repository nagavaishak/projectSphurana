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
import { cancelStockTake } from './cancel-stock-take.service.js';

describe('cancelStockTake', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { id: 'st_1', organizationId: 'org_123' };

  it('cancels an in-progress stock take', async () => {
    mockDb.query.stockTake.findFirst.mockResolvedValueOnce({
      id: 'st_1',
      status: 'in_progress',
    });
    mockDb.returning.mockResolvedValueOnce([
      { id: 'st_1', status: 'cancelled' },
    ]);

    await expectResult(
      cancelStockTake(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.status).toBe('cancelled');
    });
  });

  it('returns NOT_FOUND when missing', async () => {
    mockDb.query.stockTake.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      cancelStockTake(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns INVALID_STATE for a completed stock take', async () => {
    mockDb.query.stockTake.findFirst.mockResolvedValueOnce({
      id: 'st_1',
      status: 'completed',
    });

    await expectResult(
      cancelStockTake(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INVALID_STATE);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.stockTake.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      cancelStockTake(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
