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
import { deleteResource } from './delete-resource.service.js';

describe('deleteResource', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { id: 'res_1', organizationId: 'org_1' };

  const resourceFound = (name = 'Room 2') =>
    mockDb.query.resource.findFirst.mockResolvedValueOnce({
      id: 'res_1',
      name,
    });

  it('soft-deletes a resource with no future allocations', async () => {
    resourceFound();
    mockDb.query.appointmentResource.findMany.mockResolvedValueOnce([]);

    const data = await expectResult(
      deleteResource(mockDb as never, validInput)
    ).toSucceedWith();

    expect(data.id).toBe('res_1');
    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ deletedAt: expect.any(Date) })
    );
  });

  it('returns NOT_FOUND when the resource is not in the org', async () => {
    mockDb.query.resource.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      deleteResource(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns CONFLICT naming the resource and its upcoming bookings', async () => {
    resourceFound('Room 2');
    mockDb.query.appointmentResource.findMany.mockResolvedValueOnce([
      { id: 'ar_1' },
      { id: 'ar_2' },
      { id: 'ar_3' },
      { id: 'ar_4' },
    ]);

    const error = (await expectResult(
      deleteResource(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.CONFLICT)) as FeatureError;

    expect(error.message).toBe(
      'Room 2 has 4 upcoming bookings. Deactivate it instead, or move those bookings first.'
    );
    expect(error.details).toMatchObject({ upcomingAllocationCount: 4 });
    // The FK is ON DELETE RESTRICT — the write must never be attempted.
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('uses the singular noun for a single upcoming booking', async () => {
    resourceFound('Laser A');
    mockDb.query.appointmentResource.findMany.mockResolvedValueOnce([
      { id: 'ar_1' },
    ]);

    const error = (await expectResult(
      deleteResource(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.CONFLICT)) as FeatureError;

    expect(error.message).toBe(
      'Laser A has 1 upcoming booking. Deactivate it instead, or move those bookings first.'
    );
  });

  it('returns VALIDATION_ERROR when the id is missing', async () => {
    await expectResult(
      deleteResource(mockDb as never, { organizationId: 'org_1' } as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.resource.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      deleteResource(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
