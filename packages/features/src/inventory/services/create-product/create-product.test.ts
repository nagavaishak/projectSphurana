import { drizzleUniqueViolation } from '@borradh-workspace/database';
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
import { createProduct } from './create-product.service.js';

describe('createProduct', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    name: 'Shampoo 250ml',
  };

  it('creates a product with valid input', async () => {
    const mockProduct = { id: 'prod_1', ...validInput, measureUnit: 'whole' };
    mockDb.returning.mockResolvedValueOnce([mockProduct]);

    await expectResult(
      createProduct(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data).toEqual(mockProduct);
    });
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('applies defaults for measureUnit and flags', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: 'prod_1' }]);

    await createProduct(mockDb as never, validInput);

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        measureUnit: 'whole',
        retailEnabled: false,
        trackStock: false,
        lowStockNotify: false,
      })
    );
  });

  it('returns VALIDATION_ERROR for empty name', async () => {
    await expectResult(
      createProduct(mockDb as never, { ...validInput, name: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for invalid measure unit', async () => {
    await expectResult(
      createProduct(mockDb as never, {
        ...validInput,
        measureUnit: 'invalid' as never,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns ALREADY_EXISTS on duplicate barcode', async () => {
    mockDb.returning.mockRejectedValueOnce(
      drizzleUniqueViolation('product_org_barcode_unique')
    );

    await expectResult(
      createProduct(mockDb as never, { ...validInput, barcode: '12345' })
    ).toFailWithCode(ErrorCodes.ALREADY_EXISTS);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      createProduct(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
