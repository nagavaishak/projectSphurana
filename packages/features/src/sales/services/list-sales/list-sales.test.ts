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
import { listSales } from './list-sales.service.js';

describe('listSales', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { organizationId: 'org_123' };

  it('lists sales with total', async () => {
    mockDb.query.sale.findMany.mockResolvedValueOnce([
      { id: 'sale_1', items: [], payments: [] },
      { id: 'sale_2', items: [], payments: [] },
    ]);
    mockDb.from.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([{ total: 2 }]);

    await expectResult(listSales(mockDb as never, validInput)).toSucceedWith(
      (data) => {
        expect(data.items).toHaveLength(2);
        expect(data.total).toBe(2);
        expect(data.limit).toBe(20);
      }
    );
  });

  it('returns empty list when no sales exist', async () => {
    mockDb.query.sale.findMany.mockResolvedValueOnce([]);
    mockDb.from.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([{ total: 0 }]);

    await expectResult(listSales(mockDb as never, validInput)).toSucceedWith(
      (data) => {
        expect(data.items).toHaveLength(0);
        expect(data.total).toBe(0);
      }
    );
  });

  it('returns VALIDATION_ERROR for invalid status', async () => {
    const result = await listSales(mockDb as never, {
      ...validInput,
      // biome-ignore lint/suspicious/noExplicitAny: invalid on purpose
      status: 'bogus' as any,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
