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
import { deleteProductCategory } from './delete-product-category.service.js';

describe('deleteProductCategory', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { id: 'product-category_1', organizationId: 'org_123' };

  it('deletes a product category', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: 'product-category_1' }]);

    await expectResult(
      deleteProductCategory(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.success).toBe(true);
    });
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('returns NOT_FOUND when no row matches', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    await expectResult(
      deleteProductCategory(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      deleteProductCategory(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
