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
import { createProductCategory } from './create-product-category.service.js';

describe('createProductCategory', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    name: 'Test ProductCategory',
  };

  it('creates a product category with valid input', async () => {
    const mockRow = { id: 'product-category_1', ...validInput };
    mockDb.returning.mockResolvedValueOnce([mockRow]);

    await expectResult(
      createProductCategory(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data).toEqual(mockRow);
    });
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for empty name', async () => {
    await expectResult(
      createProductCategory(mockDb as never, { ...validInput, name: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns ALREADY_EXISTS on duplicate name', async () => {
    mockDb.returning.mockRejectedValueOnce(
      drizzleUniqueViolation('product_category_org_name_unique')
    );

    await expectResult(
      createProductCategory(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.ALREADY_EXISTS);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      createProductCategory(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
