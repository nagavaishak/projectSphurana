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
import { updateResource } from './update-resource.service.js';

describe('updateResource', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'res_1',
    organizationId: 'org_1',
    name: 'Room 3',
  };

  it('updates the resource', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: 'res_1', name: 'Room 3' }]);

    const data = await expectResult(
      updateResource(mockDb as never, validInput)
    ).toSucceedWith();

    expect(data.name).toBe('Room 3');
  });

  it('clears nullable fields when explicitly set to null', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: 'res_1' }]);

    await expectResult(
      updateResource(mockDb as never, {
        id: 'res_1',
        organizationId: 'org_1',
        workingHours: null,
        locationId: null,
      })
    ).toSucceedWith();

    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ workingHours: null, locationId: null })
    );
  });

  it('validates a new category belongs to the org', async () => {
    mockDb.query.resourceCategory.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      updateResource(mockDb as never, { ...validInput, categoryId: 'cat_x' })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('validates a new location belongs to the org', async () => {
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      updateResource(mockDb as never, { ...validInput, locationId: 'loc_x' })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns NOT_FOUND when nothing was updated', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    await expectResult(
      updateResource(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR when the id is missing', async () => {
    await expectResult(
      updateResource(mockDb as never, { organizationId: 'org_1' } as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for an out-of-range capacity', async () => {
    await expectResult(
      updateResource(mockDb as never, { ...validInput, capacity: 99 })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      updateResource(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
