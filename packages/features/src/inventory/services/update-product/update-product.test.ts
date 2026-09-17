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
import { updateProduct } from './update-product.service.js';

describe('updateProduct', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'prod_1',
    organizationId: 'org_123',
    name: 'Renamed',
  };

  it('updates a product', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: 'prod_1', name: 'Renamed' }]);

    await expectResult(
      updateProduct(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.name).toBe('Renamed');
    });
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith({ name: 'Renamed' });
  });

  it('returns NOT_FOUND when no row matches', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    await expectResult(
      updateProduct(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR when no fields to update', async () => {
    await expectResult(
      updateProduct(mockDb as never, {
        id: 'prod_1',
        organizationId: 'org_123',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns ALREADY_EXISTS on duplicate barcode', async () => {
    mockDb.returning.mockRejectedValueOnce(
      drizzleUniqueViolation('product_org_barcode_unique')
    );

    await expectResult(
      updateProduct(mockDb as never, { ...validInput, barcode: '123' })
    ).toFailWithCode(ErrorCodes.ALREADY_EXISTS);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      updateProduct(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
