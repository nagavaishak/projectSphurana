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
import { listProductCategories } from './list-product-categories.service.js';

describe('listProductCategories', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('lists product categorys for an organization', async () => {
    const rows = [
      { id: '1', name: 'A' },
      { id: '2', name: 'B' },
    ];
    mockDb.query.productCategory.findMany.mockResolvedValueOnce(rows);

    await expectResult(
      listProductCategories(mockDb as never, { organizationId: 'org_123' })
    ).toSucceedWith((data) => {
      expect(data).toHaveLength(2);
    });
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      listProductCategories(mockDb as never, { organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.productCategory.findMany.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      listProductCategories(mockDb as never, { organizationId: 'org_123' })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
