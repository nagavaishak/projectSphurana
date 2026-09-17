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
import { getProduct } from './get-product.service.js';

describe('getProduct', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { id: 'prod_1', organizationId: 'org_123' };

  it('returns the product when found', async () => {
    const mockProduct = { id: 'prod_1', name: 'Shampoo' };
    mockDb.query.product.findFirst.mockResolvedValueOnce(mockProduct);

    await expectResult(getProduct(mockDb as never, validInput)).toSucceedWith(
      (data) => {
        expect(data).toEqual(mockProduct);
      }
    );
  });

  it('returns NOT_FOUND when missing', async () => {
    mockDb.query.product.findFirst.mockResolvedValueOnce(null);

    await expectResult(getProduct(mockDb as never, validInput)).toFailWithCode(
      ErrorCodes.NOT_FOUND
    );
  });

  it('returns VALIDATION_ERROR for missing id', async () => {
    await expectResult(
      getProduct(mockDb as never, { ...validInput, id: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.product.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(getProduct(mockDb as never, validInput)).toFailWithCode(
      ErrorCodes.INTERNAL_ERROR
    );
  });
});
