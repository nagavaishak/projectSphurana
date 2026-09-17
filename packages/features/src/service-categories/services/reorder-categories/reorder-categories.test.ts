import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { reorderCategories } from './reorder-categories.service.js';

describe('reorderCategories', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('reorders categories in transaction', async () => {
    mockDb.query.organizationServiceCategory.findMany.mockResolvedValueOnce([
      { id: 'c1' },
      { id: 'c2' },
    ]);

    const result = await reorderCategories(mockDb as never, {
      organizationId: 'org_123',
      orderedIds: ['c2', 'c1'],
    });

    expect(result.success).toBe(true);
    expect(mockDb.transaction).toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR if categories do not match org', async () => {
    mockDb.query.organizationServiceCategory.findMany.mockResolvedValueOnce([
      { id: 'c1' },
    ]);

    await expectResult(
      reorderCategories(mockDb as never, {
        organizationId: 'org_123',
        orderedIds: ['c1', 'c2'],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
