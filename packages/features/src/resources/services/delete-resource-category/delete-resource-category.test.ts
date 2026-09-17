import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes, type FeatureError } from '../../../shared/index.js';
import { deleteResourceCategory } from './delete-resource-category.service.js';

describe('deleteResourceCategory', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { id: 'cat_1', organizationId: 'org_1' };

  it('soft-deletes an empty category', async () => {
    mockDb.query.resourceCategory.findFirst.mockResolvedValueOnce({
      id: 'cat_1',
    });
    mockDb.query.resource.findMany.mockResolvedValueOnce([]);

    const data = await expectResult(
      deleteResourceCategory(mockDb as never, validInput)
    ).toSucceedWith();

    expect(data.id).toBe('cat_1');
    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ deletedAt: expect.any(Date) })
    );
  });

  it('returns NOT_FOUND when the category does not exist in the org', async () => {
    mockDb.query.resourceCategory.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      deleteResourceCategory(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns CONFLICT naming the resource count', async () => {
    mockDb.query.resourceCategory.findFirst.mockResolvedValueOnce({
      id: 'cat_1',
    });
    mockDb.query.resource.findMany.mockResolvedValueOnce([
      { id: 'res_1' },
      { id: 'res_2' },
      { id: 'res_3' },
    ]);

    const error = (await expectResult(
      deleteResourceCategory(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.CONFLICT)) as FeatureError;

    expect(error.message).toBe(
      'Delete or move the 3 resources in this category first'
    );
    expect(error.details).toMatchObject({ resourceCount: 3 });
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('uses the singular noun for a single resource', async () => {
    mockDb.query.resourceCategory.findFirst.mockResolvedValueOnce({
      id: 'cat_1',
    });
    mockDb.query.resource.findMany.mockResolvedValueOnce([{ id: 'res_1' }]);

    const error = (await expectResult(
      deleteResourceCategory(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.CONFLICT)) as FeatureError;

    expect(error.message).toBe(
      'Delete or move the 1 resource in this category first'
    );
  });

  it('returns VALIDATION_ERROR when the id is missing', async () => {
    await expectResult(
      deleteResourceCategory(
        mockDb as never,
        {
          organizationId: 'org_1',
        } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.resourceCategory.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      deleteResourceCategory(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
