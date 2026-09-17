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
import { getStockTake } from './get-stock-take.service.js';

describe('getStockTake', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { id: 'st_1', organizationId: 'org_123' };

  it('returns the stock take with items', async () => {
    mockDb.query.stockTake.findFirst.mockResolvedValueOnce({
      id: 'st_1',
      items: [{ id: 'sti_1' }],
    });

    await expectResult(getStockTake(mockDb as never, validInput)).toSucceedWith(
      (data) => {
        expect(data.items).toHaveLength(1);
      }
    );
  });

  it('returns NOT_FOUND when missing', async () => {
    mockDb.query.stockTake.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getStockTake(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for missing id', async () => {
    await expectResult(
      getStockTake(mockDb as never, { ...validInput, id: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.stockTake.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      getStockTake(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
