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
import { updateSupplier } from './update-supplier.service.js';

describe('updateSupplier', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'supplier_1',
    organizationId: 'org_123',
    name: 'Renamed',
  };

  it('updates a supplier', async () => {
    const mockRow = { ...validInput };
    mockDb.returning.mockResolvedValueOnce([mockRow]);

    await expectResult(
      updateSupplier(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.name).toBe('Renamed');
    });
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('returns NOT_FOUND when no row matches', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    await expectResult(
      updateSupplier(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for empty name', async () => {
    await expectResult(
      updateSupplier(mockDb as never, { ...validInput, name: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns ALREADY_EXISTS on a name collision', async () => {
    mockDb.returning.mockRejectedValueOnce(
      drizzleUniqueViolation('supplier_org_name_unique')
    );

    await expectResult(
      updateSupplier(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.ALREADY_EXISTS);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      updateSupplier(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
