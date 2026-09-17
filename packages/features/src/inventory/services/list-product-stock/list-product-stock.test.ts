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
import { listProductStock } from './list-product-stock.service.js';

describe('listProductStock', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { productId: 'prod_1', organizationId: 'org_123' };

  it('lists stock rows per location', async () => {
    mockDb.query.product.findFirst.mockResolvedValueOnce({ id: 'prod_1' });
    mockDb.query.productStock.findMany.mockResolvedValueOnce([
      { id: 'ps_1', productId: 'prod_1', locationId: 'loc_1', quantity: 5 },
    ]);

    await expectResult(
      listProductStock(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data).toHaveLength(1);
      expect(data[0].quantity).toBe(5);
    });
  });

  it('returns NOT_FOUND when product does not belong to org', async () => {
    mockDb.query.product.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      listProductStock(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for missing productId', async () => {
    await expectResult(
      listProductStock(mockDb as never, { ...validInput, productId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.product.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      listProductStock(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
