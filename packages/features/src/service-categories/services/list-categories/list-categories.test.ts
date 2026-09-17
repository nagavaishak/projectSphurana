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
import { listCategories } from './list-categories.service.js';

describe('listCategories', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns categories ordered by sortOrder', async () => {
    mockDb.query.organizationServiceCategory.findMany.mockResolvedValueOnce([
      { id: 'c1', name: 'A', sortOrder: 0 },
      { id: 'c2', name: 'B', sortOrder: 1 },
    ]);

    const result = await listCategories(mockDb as never, {
      organizationId: 'org_123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
    }
  });

  it('returns VALIDATION_ERROR for missing org', async () => {
    await expectResult(
      listCategories(mockDb as never, {} as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
