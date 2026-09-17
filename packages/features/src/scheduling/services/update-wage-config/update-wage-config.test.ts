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
import { updateWageConfig } from './update-wage-config.service.js';

describe('updateWageConfig', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('updates an existing config with a partial patch', async () => {
    mockDb.query.practitionerWageConfig.findFirst.mockResolvedValueOnce({
      practitionerId: 'prac_1',
      organizationId: 'org_1',
      compensationType: 'none',
    });
    mockDb.returning.mockResolvedValueOnce([
      {
        practitionerId: 'prac_1',
        organizationId: 'org_1',
        compensationType: 'hourly',
        hourlyRateCents: 2500,
      },
    ]);

    const data = await expectResult(
      updateWageConfig(mockDb as never, {
        organizationId: 'org_1',
        practitionerId: 'prac_1',
        compensationType: 'hourly',
        hourlyRateCents: 2500,
      })
    ).toSucceedWith();

    expect(data.compensationType).toBe('hourly');
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('inserts a new row when none exists', async () => {
    mockDb.query.practitionerWageConfig.findFirst.mockResolvedValueOnce(null);
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      id: 'prac_1',
      organizationId: 'org_1',
    });
    mockDb.returning.mockResolvedValueOnce([
      {
        practitionerId: 'prac_1',
        organizationId: 'org_1',
        autoClockIn: 'enabled',
      },
    ]);

    const data = await expectResult(
      updateWageConfig(mockDb as never, {
        organizationId: 'org_1',
        practitionerId: 'prac_1',
        autoClockIn: 'enabled',
      })
    ).toSucceedWith();

    expect(data.autoClockIn).toBe('enabled');
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('persists the location restriction setting', async () => {
    mockDb.query.practitionerWageConfig.findFirst.mockResolvedValueOnce({
      practitionerId: 'prac_1',
      organizationId: 'org_1',
      locationRestriction: 'workspace_default',
    });
    mockDb.returning.mockResolvedValueOnce([
      {
        practitionerId: 'prac_1',
        organizationId: 'org_1',
        locationRestriction: 'enabled',
      },
    ]);

    const data = await expectResult(
      updateWageConfig(mockDb as never, {
        organizationId: 'org_1',
        practitionerId: 'prac_1',
        locationRestriction: 'enabled',
      })
    ).toSucceedWith();

    expect(data.locationRestriction).toBe('enabled');
    const setCall = mockDb.set.mock.calls[0]?.[0];
    expect(setCall).toEqual(
      expect.objectContaining({ locationRestriction: 'enabled' })
    );
  });

  it('returns VALIDATION_ERROR for an invalid location restriction', async () => {
    await expectResult(
      updateWageConfig(mockDb as never, {
        organizationId: 'org_1',
        practitionerId: 'prac_1',
        locationRestriction: 'sometimes' as never,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns NOT_FOUND for an unknown practitioner', async () => {
    mockDb.query.practitionerWageConfig.findFirst.mockResolvedValueOnce(null);
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      updateWageConfig(mockDb as never, {
        organizationId: 'org_1',
        practitionerId: 'prac_missing',
        overtimeEnabled: true,
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for an invalid compensation type', async () => {
    await expectResult(
      updateWageConfig(mockDb as never, {
        organizationId: 'org_1',
        practitionerId: 'prac_1',
        compensationType: 'salary' as never,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.practitionerWageConfig.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      updateWageConfig(mockDb as never, {
        organizationId: 'org_1',
        practitionerId: 'prac_1',
        overtimeEnabled: true,
      })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
