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
import { createProductBrand } from './create-product-brand.service.js';

describe('createProductBrand', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { organizationId: 'org_123', name: 'Test ProductBrand' };

  it('creates a product brand with valid input', async () => {
    const mockRow = { id: 'product-brand_1', ...validInput };
    mockDb.returning.mockResolvedValueOnce([mockRow]);

    await expectResult(
      createProductBrand(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data).toEqual(mockRow);
    });
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for empty name', async () => {
    await expectResult(
      createProductBrand(mockDb as never, { ...validInput, name: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns ALREADY_EXISTS on duplicate name', async () => {
    mockDb.returning.mockRejectedValueOnce(
      drizzleUniqueViolation('product_brand_org_name_unique')
    );

    await expectResult(
      createProductBrand(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.ALREADY_EXISTS);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      createProductBrand(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
