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
import { updateOrgDefaults } from './update-org-defaults.service.js';

describe('updateOrgDefaults', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('updates an existing row with a partial patch', async () => {
    mockDb.query.orgDefaults.findFirst.mockResolvedValueOnce({
      organizationId: 'org_123',
      adDailyBudgetCents: 1000,
      adObjective: 'OUTCOME_LEADS',
      videoOrientation: 'landscape',
      videoLengthSecs: 60,
      brandVoice: null,
      defaultServiceIdForAds: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockDb.returning.mockResolvedValueOnce([
      {
        organizationId: 'org_123',
        adDailyBudgetCents: 2500,
        adObjective: 'OUTCOME_LEADS',
        videoOrientation: 'landscape',
        videoLengthSecs: 60,
        brandVoice: null,
        defaultServiceIdForAds: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const data = await expectResult(
      updateOrgDefaults(mockDb as never, {
        organizationId: 'org_123',
        adDailyBudgetCents: 2500,
      })
    ).toSucceedWith();

    expect(data.adDailyBudgetCents).toBe(2500);
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('inserts a new row when none exists', async () => {
    mockDb.query.orgDefaults.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([
      {
        organizationId: 'org_new',
        adDailyBudgetCents: null,
        adObjective: null,
        videoOrientation: 'portrait',
        videoLengthSecs: null,
        brandVoice: null,
        defaultServiceIdForAds: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const data = await expectResult(
      updateOrgDefaults(mockDb as never, {
        organizationId: 'org_new',
        videoOrientation: 'portrait',
      })
    ).toSucceedWith();

    expect(data.videoOrientation).toBe('portrait');
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      updateOrgDefaults(mockDb as never, {} as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.orgDefaults.findFirst).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for negative budget', async () => {
    await expectResult(
      updateOrgDefaults(mockDb as never, {
        organizationId: 'org_123',
        adDailyBudgetCents: -100,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for invalid video orientation', async () => {
    await expectResult(
      updateOrgDefaults(mockDb as never, {
        organizationId: 'org_123',
        videoOrientation: 'square-ish' as never,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR when the database call throws', async () => {
    mockDb.query.orgDefaults.findFirst.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expectResult(
      updateOrgDefaults(mockDb as never, {
        organizationId: 'org_123',
        adDailyBudgetCents: 2500,
      })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
