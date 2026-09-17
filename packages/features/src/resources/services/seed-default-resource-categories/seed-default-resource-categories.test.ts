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
import { seedDefaultResourceCategories } from './seed-default-resource-categories.service.js';

describe('seedDefaultResourceCategories', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('creates the Rooms category when the org has none', async () => {
    mockDb.query.resourceCategory.findMany.mockResolvedValueOnce([]);
    mockDb.returning.mockResolvedValueOnce([
      { id: 'cat_1', name: 'Rooms', kind: 'room' },
    ]);

    const data = await expectResult(
      seedDefaultResourceCategories(mockDb as never, {
        organizationId: 'org_1',
      })
    ).toSucceedWith();

    expect(data.created).toHaveLength(1);
    expect(data.categories[0].name).toBe('Rooms');
    expect(mockDb.values).toHaveBeenCalledWith([
      expect.objectContaining({
        organizationId: 'org_1',
        name: 'Rooms',
        kind: 'room',
      }),
    ]);
  });

  it('is idempotent — writes nothing when a category already exists', async () => {
    mockDb.query.resourceCategory.findMany.mockResolvedValueOnce([
      { id: 'cat_9', name: 'Treatment suites' },
    ]);

    const data = await expectResult(
      seedDefaultResourceCategories(mockDb as never, {
        organizationId: 'org_1',
      })
    ).toSucceedWith();

    expect(data.created).toHaveLength(0);
    expect(data.categories).toHaveLength(1);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when organizationId is missing', async () => {
    await expectResult(
      seedDefaultResourceCategories(mockDb as never, {} as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.resourceCategory.findMany).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.resourceCategory.findMany.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      seedDefaultResourceCategories(mockDb as never, {
        organizationId: 'org_1',
      })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
