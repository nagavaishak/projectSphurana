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
import { deleteProduct } from './delete-product.service.js';

describe('deleteProduct', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { id: 'prod_1', organizationId: 'org_123' };

  it('soft-deletes by setting isActive=false', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: 'prod_1', isActive: false }]);

    await expectResult(
      deleteProduct(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.isActive).toBe(false);
    });
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith({ isActive: false });
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when no row matches', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    await expectResult(
      deleteProduct(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for missing id', async () => {
    await expectResult(
      deleteProduct(mockDb as never, { ...validInput, id: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      deleteProduct(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
