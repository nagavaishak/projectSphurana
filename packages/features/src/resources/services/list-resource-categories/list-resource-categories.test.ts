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
import { listResourceCategories } from './list-resource-categories.service.js';

describe('listResourceCategories', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns each category with its resource count', async () => {
    mockDb.query.resourceCategory.findMany.mockResolvedValueOnce([
      { id: 'cat_1', name: 'Rooms', sortOrder: 0 },
      { id: 'cat_2', name: 'Lasers', sortOrder: 1 },
    ]);
    mockDb.query.resource.findMany.mockResolvedValueOnce([
      { id: 'res_1', categoryId: 'cat_1' },
      { id: 'res_2', categoryId: 'cat_1' },
      { id: 'res_3', categoryId: 'cat_2' },
    ]);

    const data = await expectResult(
      listResourceCategories(mockDb as never, { organizationId: 'org_1' })
    ).toSucceedWith();

    expect(data.map((c) => [c.id, c.resourceCount])).toEqual([
      ['cat_1', 2],
      ['cat_2', 1],
    ]);
  });

  it('reports zero for a category with no resources', async () => {
    mockDb.query.resourceCategory.findMany.mockResolvedValueOnce([
      { id: 'cat_1', name: 'Rooms', sortOrder: 0 },
    ]);
    mockDb.query.resource.findMany.mockResolvedValueOnce([]);

    const data = await expectResult(
      listResourceCategories(mockDb as never, { organizationId: 'org_1' })
    ).toSucceedWith();

    expect(data[0].resourceCount).toBe(0);
  });

  it('orders by sortOrder then name', async () => {
    mockDb.query.resourceCategory.findMany.mockResolvedValueOnce([
      { id: 'cat_3', name: 'Zebra', sortOrder: 1 },
      { id: 'cat_1', name: 'Beds', sortOrder: 2 },
      { id: 'cat_2', name: 'Anvils', sortOrder: 1 },
    ]);
    mockDb.query.resource.findMany.mockResolvedValueOnce([]);

    const data = await expectResult(
      listResourceCategories(mockDb as never, { organizationId: 'org_1' })
    ).toSucceedWith();

    expect(data.map((c) => c.id)).toEqual(['cat_2', 'cat_3', 'cat_1']);
  });

  it('returns VALIDATION_ERROR when organizationId is missing', async () => {
    await expectResult(
      listResourceCategories(mockDb as never, {} as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.resourceCategory.findMany).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when includeInactive is not a boolean', async () => {
    await expectResult(
      listResourceCategories(mockDb as never, {
        organizationId: 'org_1',
        includeInactive: 'yes' as never,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.resourceCategory.findMany.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      listResourceCategories(mockDb as never, { organizationId: 'org_1' })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
