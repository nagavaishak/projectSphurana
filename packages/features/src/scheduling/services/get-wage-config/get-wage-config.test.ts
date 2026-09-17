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
import { getWageConfig } from './get-wage-config.service.js';

const config = {
  practitionerId: 'prac_1',
  organizationId: 'org_1',
  compensationType: 'none',
  autoClockIn: 'workspace_default',
};

describe('getWageConfig', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns the existing config', async () => {
    mockDb.query.practitionerWageConfig.findFirst.mockResolvedValueOnce(config);

    const data = await expectResult(
      getWageConfig(mockDb as never, {
        organizationId: 'org_1',
        practitionerId: 'prac_1',
      })
    ).toSucceedWith();

    expect(data.compensationType).toBe('none');
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('creates the default row on first read (upsert-on-read)', async () => {
    mockDb.query.practitionerWageConfig.findFirst.mockResolvedValueOnce(null);
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      id: 'prac_1',
      organizationId: 'org_1',
    });
    mockDb.returning.mockResolvedValueOnce([config]);

    const data = await expectResult(
      getWageConfig(mockDb as never, {
        organizationId: 'org_1',
        practitionerId: 'prac_1',
      })
    ).toSucceedWith();

    expect(data.practitionerId).toBe('prac_1');
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('returns NOT_FOUND for an unknown practitioner', async () => {
    mockDb.query.practitionerWageConfig.findFirst.mockResolvedValueOnce(null);
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getWageConfig(mockDb as never, {
        organizationId: 'org_1',
        practitionerId: 'prac_missing',
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for missing practitionerId', async () => {
    await expectResult(
      getWageConfig(mockDb as never, { organizationId: 'org_1' } as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.practitionerWageConfig.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      getWageConfig(mockDb as never, {
        organizationId: 'org_1',
        practitionerId: 'prac_1',
      })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
  // Regression: the primary key is `practitioner_id` ALONE, so the insert also
  // conflicts when a config exists for this practitioner under a DIFFERENT
  // organization. The read-back after that conflict used to filter on
  // practitioner only, which would hand back the other organization's pay
  // rates. It must stay scoped and fail closed instead.
  it('does not return another organization config after an insert conflict', async () => {
    // 1. org-scoped read finds nothing
    mockDb.query.practitionerWageConfig.findFirst.mockResolvedValueOnce(
      undefined
    );
    // 2. practitioner does belong to this org
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      id: 'prac_1',
      organizationId: 'org_1',
    });
    // 3. insert conflicts (a row exists under org_2) -> nothing returned
    mockDb.returning.mockResolvedValueOnce([]);
    // 4. scoped read-back still finds nothing for THIS org
    mockDb.query.practitionerWageConfig.findFirst.mockResolvedValueOnce(
      undefined
    );

    const result = await getWageConfig(mockDb as never, {
      organizationId: 'org_1',
      practitionerId: 'prac_1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }

    // Two reads happened (initial + post-conflict read-back), both scoped to
    // the organization. The mock cannot evaluate SQL, so scoping itself is
    // enforced by the query; what this pins is that an unreadable row fails
    // CLOSED rather than falling through to another organization's config.
    expect(mockDb.query.practitionerWageConfig.findFirst).toHaveBeenCalledTimes(
      2
    );
  });
});
