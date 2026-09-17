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
import { deleteCategory } from './delete-category.service.js';

describe('deleteCategory', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('deletes a category that has no services', async () => {
    mockDb.query.organizationServiceCategory.findFirst.mockResolvedValueOnce({
      id: 'cat_123',
    });
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);

    const result = await deleteCategory(mockDb as never, {
      id: 'cat_123',
      organizationId: 'org_123',
    });

    expect(result.success).toBe(true);
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('returns CONFLICT when services still reference the category', async () => {
    mockDb.query.organizationServiceCategory.findFirst.mockResolvedValueOnce({
      id: 'cat_123',
    });
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc_1',
    });

    await expectResult(
      deleteCategory(mockDb as never, {
        id: 'cat_123',
        organizationId: 'org_123',
      })
    ).toFailWithCode(ErrorCodes.CONFLICT);

    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when missing', async () => {
    mockDb.query.organizationServiceCategory.findFirst.mockResolvedValueOnce(
      null
    );

    await expectResult(
      deleteCategory(mockDb as never, {
        id: 'cat_missing',
        organizationId: 'org_123',
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });
});
