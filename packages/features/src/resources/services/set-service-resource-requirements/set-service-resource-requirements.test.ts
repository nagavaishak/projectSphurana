import {
  organizationService,
  serviceResourceEligibility,
  serviceResourceRequirement,
} from '@borradh-workspace/database';
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
import { setServiceResourceRequirements } from './set-service-resource-requirements.service.js';

describe('setServiceResourceRequirements', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const serviceFound = (turnaroundMinutes: number | null = null) =>
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc_1',
      turnaroundMinutes,
    });

  it('replaces the whole set transactionally', async () => {
    serviceFound();
    mockDb.query.resourceCategory.findMany.mockResolvedValueOnce([
      { id: 'cat_1' },
    ]);
    mockDb.query.resource.findMany.mockResolvedValueOnce([
      { id: 'res_1', categoryId: 'cat_1' },
    ]);

    const data = await expectResult(
      setServiceResourceRequirements(mockDb as never, {
        organizationId: 'org_1',
        serviceId: 'svc_1',
        requirements: [{ categoryId: 'cat_1', eligibleResourceIds: ['res_1'] }],
      })
    ).toSucceedWith();

    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    // Delete-then-insert: both tables are cleared for this service first.
    expect(mockDb.delete).toHaveBeenCalledWith(serviceResourceEligibility);
    expect(mockDb.delete).toHaveBeenCalledWith(serviceResourceRequirement);
    expect(mockDb.insert).toHaveBeenCalledWith(serviceResourceRequirement);
    expect(mockDb.insert).toHaveBeenCalledWith(serviceResourceEligibility);
    expect(data.requirements).toEqual([
      { categoryId: 'cat_1', eligibleResourceIds: ['res_1'] },
    ]);
  });

  it('writes ZERO eligibility rows when eligibleResourceIds is empty', async () => {
    serviceFound();
    mockDb.query.resourceCategory.findMany.mockResolvedValueOnce([
      { id: 'cat_1' },
    ]);

    const data = await expectResult(
      setServiceResourceRequirements(mockDb as never, {
        organizationId: 'org_1',
        serviceId: 'svc_1',
        requirements: [{ categoryId: 'cat_1', eligibleResourceIds: [] }],
      })
    ).toSucceedWith();

    // Empty means "any resource in this category" — expanding it into one row
    // per resource would silently break the next time a room is added.
    expect(mockDb.insert).toHaveBeenCalledWith(serviceResourceRequirement);
    expect(mockDb.insert).not.toHaveBeenCalledWith(serviceResourceEligibility);
    expect(mockDb.query.resource.findMany).not.toHaveBeenCalled();
    expect(data.requirements[0].eligibleResourceIds).toEqual([]);
  });

  it('defaults a missing eligibleResourceIds to "any resource"', async () => {
    serviceFound();
    mockDb.query.resourceCategory.findMany.mockResolvedValueOnce([
      { id: 'cat_1' },
    ]);

    const data = await expectResult(
      setServiceResourceRequirements(mockDb as never, {
        organizationId: 'org_1',
        serviceId: 'svc_1',
        requirements: [{ categoryId: 'cat_1' }],
      })
    ).toSucceedWith();

    expect(data.requirements[0].eligibleResourceIds).toEqual([]);
    expect(mockDb.insert).not.toHaveBeenCalledWith(serviceResourceEligibility);
  });

  it('clears every requirement when given an empty set', async () => {
    serviceFound();

    const data = await expectResult(
      setServiceResourceRequirements(mockDb as never, {
        organizationId: 'org_1',
        serviceId: 'svc_1',
        requirements: [],
      })
    ).toSucceedWith();

    expect(mockDb.delete).toHaveBeenCalledWith(serviceResourceRequirement);
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(data.requirements).toEqual([]);
  });

  it('updates the service turnaround when one is given', async () => {
    serviceFound(null);

    const data = await expectResult(
      setServiceResourceRequirements(mockDb as never, {
        organizationId: 'org_1',
        serviceId: 'svc_1',
        turnaroundMinutes: 15,
        requirements: [],
      })
    ).toSucceedWith();

    expect(mockDb.update).toHaveBeenCalledWith(organizationService);
    expect(mockDb.set).toHaveBeenCalledWith({ turnaroundMinutes: 15 });
    expect(data.turnaroundMinutes).toBe(15);
  });

  it('clears the turnaround when explicitly null', async () => {
    serviceFound(30);

    const data = await expectResult(
      setServiceResourceRequirements(mockDb as never, {
        organizationId: 'org_1',
        serviceId: 'svc_1',
        turnaroundMinutes: null,
        requirements: [],
      })
    ).toSucceedWith();

    expect(mockDb.set).toHaveBeenCalledWith({ turnaroundMinutes: null });
    expect(data.turnaroundMinutes).toBeNull();
  });

  it('leaves the turnaround untouched when omitted', async () => {
    serviceFound(30);

    const data = await expectResult(
      setServiceResourceRequirements(mockDb as never, {
        organizationId: 'org_1',
        serviceId: 'svc_1',
        requirements: [],
      })
    ).toSucceedWith();

    expect(mockDb.update).not.toHaveBeenCalled();
    expect(data.turnaroundMinutes).toBe(30);
  });

  it.each([7, 245, -5])(
    'returns VALIDATION_ERROR for turnaround %s',
    async (turnaroundMinutes) => {
      await expectResult(
        setServiceResourceRequirements(mockDb as never, {
          organizationId: 'org_1',
          serviceId: 'svc_1',
          turnaroundMinutes,
          requirements: [],
        })
      ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

      expect(mockDb.transaction).not.toHaveBeenCalled();
    }
  );

  it('returns VALIDATION_ERROR when a category appears twice', async () => {
    await expectResult(
      setServiceResourceRequirements(mockDb as never, {
        organizationId: 'org_1',
        serviceId: 'svc_1',
        requirements: [
          { categoryId: 'cat_1', eligibleResourceIds: [] },
          { categoryId: 'cat_1', eligibleResourceIds: [] },
        ],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR when serviceId is missing', async () => {
    await expectResult(
      setServiceResourceRequirements(
        mockDb as never,
        {
          organizationId: 'org_1',
          requirements: [],
        } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns NOT_FOUND when the service is not in the org', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      setServiceResourceRequirements(mockDb as never, {
        organizationId: 'org_1',
        serviceId: 'svc_1',
        requirements: [],
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when a category belongs to another org', async () => {
    serviceFound();
    mockDb.query.resourceCategory.findMany.mockResolvedValueOnce([]);

    await expectResult(
      setServiceResourceRequirements(mockDb as never, {
        organizationId: 'org_1',
        serviceId: 'svc_1',
        requirements: [{ categoryId: 'cat_x', eligibleResourceIds: [] }],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when an eligible resource is in another category', async () => {
    serviceFound();
    mockDb.query.resourceCategory.findMany.mockResolvedValueOnce([
      { id: 'cat_1' },
    ]);
    mockDb.query.resource.findMany.mockResolvedValueOnce([
      { id: 'res_1', categoryId: 'cat_2' },
    ]);

    await expectResult(
      setServiceResourceRequirements(mockDb as never, {
        organizationId: 'org_1',
        serviceId: 'svc_1',
        requirements: [{ categoryId: 'cat_1', eligibleResourceIds: ['res_1'] }],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.organizationService.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      setServiceResourceRequirements(mockDb as never, {
        organizationId: 'org_1',
        serviceId: 'svc_1',
        requirements: [],
      })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
