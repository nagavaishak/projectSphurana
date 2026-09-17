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
import { getServiceResourceRequirements } from './get-service-resource-requirements.service.js';

describe('getServiceResourceRequirements', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { organizationId: 'org_1', serviceId: 'svc_1' };

  it('returns the requirement set with its turnaround and eligible resources', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc_1',
      turnaroundMinutes: 15,
    });
    mockDb.query.serviceResourceRequirement.findMany.mockResolvedValueOnce([
      {
        categoryId: 'cat_1',
        category: { id: 'cat_1', name: 'Rooms', kind: 'room' },
      },
      {
        categoryId: 'cat_2',
        category: { id: 'cat_2', name: 'Lasers', kind: 'equipment' },
      },
    ]);
    mockDb.query.serviceResourceEligibility.findMany.mockResolvedValueOnce([
      { resourceId: 'res_9', resource: { id: 'res_9', categoryId: 'cat_2' } },
    ]);

    const data = await expectResult(
      getServiceResourceRequirements(mockDb as never, validInput)
    ).toSucceedWith();

    expect(data.turnaroundMinutes).toBe(15);
    expect(data.requirements).toEqual([
      {
        categoryId: 'cat_1',
        categoryName: 'Rooms',
        categoryKind: 'room',
        // Zero eligibility rows = ANY resource in this category.
        eligibleResourceIds: [],
      },
      {
        categoryId: 'cat_2',
        categoryName: 'Lasers',
        categoryKind: 'equipment',
        eligibleResourceIds: ['res_9'],
      },
    ]);
  });

  it('normalises a null turnaround', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc_1',
      turnaroundMinutes: null,
    });
    mockDb.query.serviceResourceRequirement.findMany.mockResolvedValueOnce([]);
    mockDb.query.serviceResourceEligibility.findMany.mockResolvedValueOnce([]);

    const data = await expectResult(
      getServiceResourceRequirements(mockDb as never, validInput)
    ).toSucceedWith();

    expect(data).toEqual({
      serviceId: 'svc_1',
      turnaroundMinutes: null,
      requirements: [],
    });
  });

  it('returns NOT_FOUND when the service is not in the org', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getServiceResourceRequirements(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(
      mockDb.query.serviceResourceRequirement.findMany
    ).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when serviceId is missing', async () => {
    await expectResult(
      getServiceResourceRequirements(
        mockDb as never,
        {
          organizationId: 'org_1',
        } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR when organizationId is missing', async () => {
    await expectResult(
      getServiceResourceRequirements(
        mockDb as never,
        {
          serviceId: 'svc_1',
        } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.organizationService.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      getServiceResourceRequirements(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
