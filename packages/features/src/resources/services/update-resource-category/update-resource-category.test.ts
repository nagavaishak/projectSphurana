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
import { updateResourceCategory } from './update-resource-category.service.js';

describe('updateResourceCategory', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { id: 'cat_1', organizationId: 'org_1', name: 'Suites' };

  it('updates the category', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: 'cat_1', name: 'Suites' }]);

    const data = await expectResult(
      updateResourceCategory(mockDb as never, validInput)
    ).toSucceedWith();

    expect(data.name).toBe('Suites');
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Suites' })
    );
  });

  it('omits undefined fields from the patch', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: 'cat_1' }]);

    await expectResult(
      updateResourceCategory(mockDb as never, {
        id: 'cat_1',
        organizationId: 'org_1',
        isActive: false,
      })
    ).toSucceedWith();

    const patch = mockDb.set.mock.calls[0][0] as Record<string, unknown>;
    expect(patch).toHaveProperty('isActive', false);
    expect(patch).not.toHaveProperty('name');
  });

  it('returns NOT_FOUND when nothing was updated', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    await expectResult(
      updateResourceCategory(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR when the id is missing', async () => {
    await expectResult(
      updateResourceCategory(
        mockDb as never,
        {
          organizationId: 'org_1',
        } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for an invalid sortOrder', async () => {
    await expectResult(
      updateResourceCategory(mockDb as never, {
        ...validInput,
        sortOrder: -1,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns ALREADY_EXISTS when renaming onto an existing name', async () => {
    mockDb.returning.mockRejectedValueOnce(
      new Error(
        'duplicate key value violates unique constraint "resource_category_org_name_unique"'
      )
    );

    await expectResult(
      updateResourceCategory(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.ALREADY_EXISTS);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      updateResourceCategory(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
