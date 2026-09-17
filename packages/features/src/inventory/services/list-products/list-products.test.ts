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
import { listProducts } from './list-products.service.js';

describe('listProducts', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { organizationId: 'org_123' };

  it('lists products with pagination defaults', async () => {
    mockDb.query.product.findMany.mockResolvedValueOnce([
      { id: 'prod_1', name: 'A' },
      { id: 'prod_2', name: 'B' },
    ]);
    mockDb.from.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([{ total: 2 }]);

    await expectResult(listProducts(mockDb as never, validInput)).toSucceedWith(
      (data) => {
        expect(data.items).toHaveLength(2);
        expect(data.total).toBe(2);
        expect(data.limit).toBe(50);
        expect(data.offset).toBe(0);
      }
    );
  });

  it('returns empty list when no products exist', async () => {
    mockDb.query.product.findMany.mockResolvedValueOnce([]);
    mockDb.from.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([{ total: 0 }]);

    await expectResult(listProducts(mockDb as never, validInput)).toSucceedWith(
      (data) => {
        expect(data.items).toHaveLength(0);
        expect(data.total).toBe(0);
      }
    );
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      listProducts(mockDb as never, { organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.product.findMany.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      listProducts(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
