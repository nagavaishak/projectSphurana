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
import { updateCategory } from './update-category.service.js';

describe('updateCategory', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('updates category with valid input', async () => {
    mockDb.query.organizationServiceCategory.findFirst.mockResolvedValueOnce({
      id: 'cat_123',
      name: 'Hair',
    });
    mockDb.returning.mockResolvedValueOnce([{ id: 'cat_123', name: 'Hair' }]);

    const result = await updateCategory(mockDb as never, {
      id: 'cat_123',
      organizationId: 'org_123',
      sortOrder: 5,
    });

    expect(result.success).toBe(true);
  });

  it('returns NOT_FOUND for missing category', async () => {
    mockDb.query.organizationServiceCategory.findFirst.mockResolvedValueOnce(
      null
    );

    await expectResult(
      updateCategory(mockDb as never, {
        id: 'cat_missing',
        organizationId: 'org_123',
        sortOrder: 5,
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });
});
