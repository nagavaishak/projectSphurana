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
import { assignPractitionerLocations } from './assign-practitioner-locations.service.js';

const ORG_ID = '550e8400-e29b-41d4-a716-446655440000';
const PRAC_ID = 'prac-1';

describe('assignPractitionerLocations', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockDb.returning.mockReset();
    mockDb.returning.mockResolvedValue([]);
  });

  it('assigns locations to practitioner', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      id: PRAC_ID,
      organizationId: ORG_ID,
    });
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      { id: 'loc-1', organizationId: ORG_ID },
      { id: 'loc-2', organizationId: ORG_ID },
    ]);

    const locations = [
      { locationId: 'loc-1', workingHours: null },
      {
        locationId: 'loc-2',
        workingHours: { monday: { from: 540, to: 1020 } },
      },
    ];

    const result = await assignPractitionerLocations(mockDb as never, {
      practitionerId: PRAC_ID,
      organizationId: ORG_ID,
      locations,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.practitionerId).toBe(PRAC_ID);
      expect(result.data.locations).toHaveLength(2);
    }
    expect(mockDb.delete).toHaveBeenCalled();
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('assigns empty locations (clears all)', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      id: PRAC_ID,
      organizationId: ORG_ID,
    });

    const result = await assignPractitionerLocations(mockDb as never, {
      practitionerId: PRAC_ID,
      organizationId: ORG_ID,
      locations: [],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.locations).toHaveLength(0);
    }
    expect(mockDb.delete).toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when practitioner does not exist', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      assignPractitionerLocations(mockDb as never, {
        practitionerId: PRAC_ID,
        organizationId: ORG_ID,
        locations: [{ locationId: 'loc-1' }],
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR when locations not found in org', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      id: PRAC_ID,
      organizationId: ORG_ID,
    });
    // Only 1 of 2 locations found
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      { id: 'loc-1', organizationId: ORG_ID },
    ]);

    await expectResult(
      assignPractitionerLocations(mockDb as never, {
        practitionerId: PRAC_ID,
        organizationId: ORG_ID,
        locations: [{ locationId: 'loc-1' }, { locationId: 'loc-missing' }],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for empty practitionerId', async () => {
    await expectResult(
      assignPractitionerLocations(mockDb as never, {
        practitionerId: '',
        organizationId: ORG_ID,
        locations: [],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for empty organizationId', async () => {
    await expectResult(
      assignPractitionerLocations(mockDb as never, {
        practitionerId: PRAC_ID,
        organizationId: '',
        locations: [],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on DB failure during insert', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      id: PRAC_ID,
      organizationId: ORG_ID,
    });
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      { id: 'loc-1', organizationId: ORG_ID },
    ]);
    mockDb.values.mockImplementationOnce(() => {
      throw new Error('Database insert failed');
    });

    await expectResult(
      assignPractitionerLocations(mockDb as never, {
        practitionerId: PRAC_ID,
        organizationId: ORG_ID,
        locations: [{ locationId: 'loc-1' }],
      })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
