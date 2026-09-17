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
import { deleteProductBrand } from './delete-product-brand.service.js';

describe('deleteProductBrand', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { id: 'product-brand_1', organizationId: 'org_123' };

  it('deletes a product brand', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: 'product-brand_1' }]);

    await expectResult(
      deleteProductBrand(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.success).toBe(true);
    });
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('returns NOT_FOUND when no row matches', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    await expectResult(
      deleteProductBrand(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      deleteProductBrand(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
