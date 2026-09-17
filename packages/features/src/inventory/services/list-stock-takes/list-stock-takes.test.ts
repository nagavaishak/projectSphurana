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
import { listStockTakes } from './list-stock-takes.service.js';

describe('listStockTakes', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { organizationId: 'org_123' };

  it('lists stock takes with pagination', async () => {
    mockDb.query.stockTake.findMany.mockResolvedValueOnce([
      { id: 'st_1', status: 'in_progress' },
    ]);
    mockDb.from.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([{ total: 1 }]);

    await expectResult(
      listStockTakes(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.items).toHaveLength(1);
      expect(data.total).toBe(1);
    });
  });

  it('returns VALIDATION_ERROR for invalid status', async () => {
    await expectResult(
      listStockTakes(mockDb as never, {
        ...validInput,
        status: 'bogus' as never,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.stockTake.findMany.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      listStockTakes(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
