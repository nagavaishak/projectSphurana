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
import { assignPractitionerServices } from './assign-practitioner-services.service.js';

const ORG_ID = '550e8400-e29b-41d4-a716-446655440000';
const PRAC_ID = 'prac-1';

describe('assignPractitionerServices', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockDb.returning.mockReset();
    mockDb.returning.mockResolvedValue([]);
  });

  it('assigns services to practitioner', async () => {
    // Mock: practitioner exists
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      id: PRAC_ID,
      organizationId: ORG_ID,
    });
    // Mock: services exist in org
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([
      { id: 'svc-1', organizationId: ORG_ID },
      { id: 'svc-2', organizationId: ORG_ID },
    ]);

    const result = await assignPractitionerServices(mockDb as never, {
      practitionerId: PRAC_ID,
      organizationId: ORG_ID,
      serviceIds: ['svc-1', 'svc-2'],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.practitionerId).toBe(PRAC_ID);
      expect(result.data.serviceIds).toEqual(['svc-1', 'svc-2']);
    }
    expect(mockDb.delete).toHaveBeenCalled();
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('assigns empty services (clears all)', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      id: PRAC_ID,
      organizationId: ORG_ID,
    });

    const result = await assignPractitionerServices(mockDb as never, {
      practitionerId: PRAC_ID,
      organizationId: ORG_ID,
      serviceIds: [],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.serviceIds).toEqual([]);
    }
    expect(mockDb.delete).toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when practitioner does not exist', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      assignPractitionerServices(mockDb as never, {
        practitionerId: PRAC_ID,
        organizationId: ORG_ID,
        serviceIds: ['svc-1'],
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR when services not found in org', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      id: PRAC_ID,
      organizationId: ORG_ID,
    });
    // Only 1 of 2 services found
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([
      { id: 'svc-1', organizationId: ORG_ID },
    ]);

    await expectResult(
      assignPractitionerServices(mockDb as never, {
        practitionerId: PRAC_ID,
        organizationId: ORG_ID,
        serviceIds: ['svc-1', 'svc-missing'],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for empty practitionerId', async () => {
    await expectResult(
      assignPractitionerServices(mockDb as never, {
        practitionerId: '',
        organizationId: ORG_ID,
        serviceIds: [],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on DB failure during insert', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      id: PRAC_ID,
      organizationId: ORG_ID,
    });
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([
      { id: 'svc-1', organizationId: ORG_ID },
    ]);
    // delete succeeds but insert fails
    mockDb.values.mockImplementationOnce(() => {
      throw new Error('Database insert failed');
    });

    await expectResult(
      assignPractitionerServices(mockDb as never, {
        practitionerId: PRAC_ID,
        organizationId: ORG_ID,
        serviceIds: ['svc-1'],
      })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
