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
import { listPractitionersForService } from './list-practitioners-for-service.service.js';

const ORG_ID = '550e8400-e29b-41d4-a716-446655440000';
const SERVICE_ID = 'svc-1';

describe('listPractitionersForService', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns practitioners assigned to a service', async () => {
    mockDb.query.practitionerService.findMany.mockResolvedValueOnce([
      {
        practitioner: {
          id: 'prac-1',
          organizationId: ORG_ID,
          name: 'Jane Doe',
          isActive: true,
          locations: [],
        },
      },
      {
        practitioner: {
          id: 'prac-2',
          organizationId: ORG_ID,
          name: 'John Smith',
          isActive: true,
          locations: [],
        },
      },
    ]);

    const result = await listPractitionersForService(mockDb as never, {
      serviceId: SERVICE_ID,
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
    }
  });

  it('filters out practitioners from other organizations', async () => {
    mockDb.query.practitionerService.findMany.mockResolvedValueOnce([
      {
        practitioner: {
          id: 'prac-1',
          organizationId: ORG_ID,
          name: 'Jane Doe',
          isActive: true,
          locations: [],
        },
      },
      {
        practitioner: {
          id: 'prac-other',
          organizationId: 'other-org',
          name: 'Other Org',
          isActive: true,
          locations: [],
        },
      },
    ]);

    const result = await listPractitionersForService(mockDb as never, {
      serviceId: SERVICE_ID,
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('prac-1');
    }
  });

  it('filters out inactive practitioners when activeOnly is true', async () => {
    mockDb.query.practitionerService.findMany.mockResolvedValueOnce([
      {
        practitioner: {
          id: 'prac-1',
          organizationId: ORG_ID,
          name: 'Active',
          isActive: true,
          locations: [],
        },
      },
      {
        practitioner: {
          id: 'prac-2',
          organizationId: ORG_ID,
          name: 'Inactive',
          isActive: false,
          locations: [],
        },
      },
    ]);

    const result = await listPractitionersForService(mockDb as never, {
      serviceId: SERVICE_ID,
      organizationId: ORG_ID,
      activeOnly: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('Active');
    }
  });

  it('includes inactive practitioners when activeOnly is false', async () => {
    mockDb.query.practitionerService.findMany.mockResolvedValueOnce([
      {
        practitioner: {
          id: 'prac-1',
          organizationId: ORG_ID,
          name: 'Active',
          isActive: true,
          locations: [],
        },
      },
      {
        practitioner: {
          id: 'prac-2',
          organizationId: ORG_ID,
          name: 'Inactive',
          isActive: false,
          locations: [],
        },
      },
    ]);

    const result = await listPractitionersForService(mockDb as never, {
      serviceId: SERVICE_ID,
      organizationId: ORG_ID,
      activeOnly: false,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
    }
  });

  it('returns empty array when no practitioners assigned', async () => {
    mockDb.query.practitionerService.findMany.mockResolvedValueOnce([]);

    const result = await listPractitionersForService(mockDb as never, {
      serviceId: SERVICE_ID,
      organizationId: ORG_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(0);
    }
  });

  it('returns VALIDATION_ERROR for empty serviceId', async () => {
    await expectResult(
      listPractitionersForService(mockDb as never, {
        serviceId: '',
        organizationId: ORG_ID,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for empty organizationId', async () => {
    await expectResult(
      listPractitionersForService(mockDb as never, {
        serviceId: SERVICE_ID,
        organizationId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
