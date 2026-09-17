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
import { createResource } from './create-resource.service.js';

describe('createResource', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_1',
    categoryId: 'cat_1',
    name: 'Room 2',
  };

  const categoryFound = () =>
    mockDb.query.resourceCategory.findFirst.mockResolvedValueOnce({
      id: 'cat_1',
    });

  /**
   * The next free slot in the category. The service reads it with a
   * `select().from().where()` chain, so the fake has to resolve at `where`.
   */
  const nextSortOrderIs = (next: number) =>
    mockDb.where.mockResolvedValueOnce([{ next }]);

  it('creates a resource and defaults capacity to 1', async () => {
    categoryFound();
    nextSortOrderIs(0);
    mockDb.returning.mockResolvedValueOnce([{ id: 'res_1', name: 'Room 2' }]);

    const data = await expectResult(
      createResource(mockDb as never, validInput)
    ).toSucceedWith();

    expect(data.name).toBe('Room 2');
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ capacity: 1 })
    );
  });

  it('validates the location when one is given', async () => {
    categoryFound();
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
      id: 'loc_1',
    });
    mockDb.returning.mockResolvedValueOnce([{ id: 'res_1' }]);

    await expectResult(
      createResource(mockDb as never, { ...validInput, locationId: 'loc_1' })
    ).toSucceedWith();

    expect(mockDb.query.organizationLocation.findFirst).toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the category is not in the org', async () => {
    mockDb.query.resourceCategory.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      createResource(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the location is not in the org', async () => {
    categoryFound();
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      createResource(mockDb as never, { ...validInput, locationId: 'loc_x' })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when categoryId is missing', async () => {
    await expectResult(
      createResource(
        mockDb as never,
        {
          organizationId: 'org_1',
          name: 'Room 2',
        } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR when the name is empty', async () => {
    await expectResult(
      createResource(mockDb as never, { ...validInput, name: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it.each([0, 21, 1.5])(
    'returns VALIDATION_ERROR for capacity %s',
    async (capacity) => {
      await expectResult(
        createResource(mockDb as never, { ...validInput, capacity })
      ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    }
  );

  it('returns VALIDATION_ERROR for an unknown colour', async () => {
    await expectResult(
      createResource(mockDb as never, {
        ...validInput,
        color: 'chartreuse' as never,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('accepts a clinic-defined spec record', async () => {
    categoryFound();
    mockDb.returning.mockResolvedValueOnce([{ id: 'res_1' }]);

    await expectResult(
      createResource(mockDb as never, {
        ...validInput,
        specs: { Size: '3.5 x 4m', Device: 'Lumenis M22' },
      })
    ).toSucceedWith();

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        specs: { Size: '3.5 x 4m', Device: 'Lumenis M22' },
      })
    );
  });

  it('returns VALIDATION_ERROR for more than 20 specs', async () => {
    const specs = Object.fromEntries(
      Array.from({ length: 21 }, (_, i) => [`key${i}`, 'value'])
    );

    await expectResult(
      createResource(mockDb as never, { ...validInput, specs })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for an over-long spec value', async () => {
    await expectResult(
      createResource(mockDb as never, {
        ...validInput,
        specs: { Device: 'v'.repeat(61) },
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('accepts working hours and treats absence as always-available', async () => {
    categoryFound();
    mockDb.returning.mockResolvedValueOnce([{ id: 'res_1' }]);

    await expectResult(
      createResource(mockDb as never, {
        ...validInput,
        workingHours: { '1': { from: 540, to: 1020 } },
      })
    ).toSucceedWith();

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        workingHours: { '1': { from: 540, to: 1020 } },
      })
    );
  });

  it('returns VALIDATION_ERROR when working hours end before they start', async () => {
    await expectResult(
      createResource(mockDb as never, {
        ...validInput,
        workingHours: { '1': { from: 1020, to: 540 } },
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for a day key outside 0-6', async () => {
    await expectResult(
      createResource(mockDb as never, {
        ...validInput,
        workingHours: { '7': { from: 540, to: 1020 } },
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for minutes beyond a single day', async () => {
    await expectResult(
      createResource(mockDb as never, {
        ...validInput,
        workingHours: { '1': { from: 540, to: 1441 } },
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    categoryFound();
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      createResource(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});

/**
 * `sortOrder` is the FIRST tie-break the allocator uses when several rooms are
 * free (`filter-slots-by-resources`). Every row defaulting to 0 pushed that
 * decision onto the cuid, so a two-room clinic saw its rooms picked in id
 * order — reproducibly "always Room 2 first".
 */
describe('createResource — sortOrder', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const categoryFound = () =>
    mockDb.query.resourceCategory.findFirst.mockResolvedValueOnce({
      id: 'cat_1',
    });

  it('appends after the last resource in the category', async () => {
    categoryFound();
    mockDb.where.mockResolvedValueOnce([{ next: 3 }]);
    mockDb.returning.mockResolvedValueOnce([{ id: 'res_9', name: 'Room 4' }]);

    await expectResult(
      createResource(mockDb as never, {
        organizationId: 'org_1',
        categoryId: 'cat_1',
        name: 'Room 4',
      })
    ).toSucceedWith();

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ sortOrder: 3 })
    );
  });

  it('starts an empty category at 0', async () => {
    categoryFound();
    mockDb.where.mockResolvedValueOnce([{ next: 0 }]);
    mockDb.returning.mockResolvedValueOnce([{ id: 'res_1', name: 'Room 1' }]);

    await expectResult(
      createResource(mockDb as never, {
        organizationId: 'org_1',
        categoryId: 'cat_1',
        name: 'Room 1',
      })
    ).toSucceedWith();

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ sortOrder: 0 })
    );
  });

  it('honours an explicit sortOrder without querying for one', async () => {
    categoryFound();
    mockDb.returning.mockResolvedValueOnce([{ id: 'res_2', name: 'Room 2' }]);

    await expectResult(
      createResource(mockDb as never, {
        organizationId: 'org_1',
        categoryId: 'cat_1',
        name: 'Room 2',
        sortOrder: 7,
      })
    ).toSucceedWith();

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ sortOrder: 7 })
    );
  });
});
