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
import { createResourceCategory } from './create-resource-category.service.js';

describe('createResourceCategory', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { organizationId: 'org_1', name: 'Rooms' };

  it('creates a category and defaults its kind to room', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { id: 'cat_1', organizationId: 'org_1', name: 'Rooms', kind: 'room' },
    ]);

    const data = await expectResult(
      createResourceCategory(mockDb as never, validInput)
    ).toSucceedWith();

    expect(data.name).toBe('Rooms');
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'room' })
    );
  });

  it('accepts an explicit kind', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { id: 'cat_2', kind: 'equipment' },
    ]);

    await expectResult(
      createResourceCategory(mockDb as never, {
        ...validInput,
        name: 'Lasers',
        kind: 'equipment',
      })
    ).toSucceedWith();

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'equipment' })
    );
  });

  it('returns VALIDATION_ERROR when organizationId is missing', async () => {
    await expectResult(
      createResourceCategory(mockDb as never, { name: 'Rooms' } as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when the name is empty', async () => {
    await expectResult(
      createResourceCategory(mockDb as never, { ...validInput, name: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when the name is longer than 80 characters', async () => {
    await expectResult(
      createResourceCategory(mockDb as never, {
        ...validInput,
        name: 'r'.repeat(81),
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for an unknown kind', async () => {
    await expectResult(
      createResourceCategory(mockDb as never, {
        ...validInput,
        kind: 'spaceship' as never,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('maps the partial unique index violation to ALREADY_EXISTS', async () => {
    mockDb.returning.mockRejectedValueOnce(
      new Error(
        'duplicate key value violates unique constraint "resource_category_org_name_unique"'
      )
    );

    await expectResult(
      createResourceCategory(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.ALREADY_EXISTS);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      createResourceCategory(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
