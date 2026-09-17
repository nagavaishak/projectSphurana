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
import { SYSTEM_DEFAULTS } from '../system-defaults.js';
import { getOrgDefaults } from './get-org-defaults.service.js';

describe('getOrgDefaults', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { organizationId: 'org_123' };

  it('returns the stored row merged with itself when a row exists', async () => {
    mockDb.query.orgDefaults.findFirst.mockResolvedValueOnce({
      organizationId: 'org_123',
      adDailyBudgetCents: 2500,
      adObjective: 'OUTCOME_TRAFFIC',
      videoOrientation: 'portrait',
      videoLengthSecs: 30,
      brandVoice: 'warm and clinical',
      defaultServiceIdForAds: 'svc_abc',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const data = await expectResult(
      getOrgDefaults(mockDb as never, validInput)
    ).toSucceedWith();

    expect(data.organizationId).toBe('org_123');
    expect(data.adDailyBudgetCents).toBe(2500);
    expect(data.adObjective).toBe('OUTCOME_TRAFFIC');
    expect(data.videoOrientation).toBe('portrait');
    expect(data.videoLengthSecs).toBe(30);
    expect(data.brandVoice).toBe('warm and clinical');
    expect(data.defaultServiceIdForAds).toBe('svc_abc');
  });

  it('returns system defaults when no row exists', async () => {
    mockDb.query.orgDefaults.findFirst.mockResolvedValueOnce(null);

    const data = await expectResult(
      getOrgDefaults(mockDb as never, validInput)
    ).toSucceedWith();

    expect(data.organizationId).toBe('org_123');
    expect(data.adDailyBudgetCents).toBe(SYSTEM_DEFAULTS.adDailyBudgetCents);
    expect(data.adObjective).toBe(SYSTEM_DEFAULTS.adObjective);
    expect(data.videoOrientation).toBe(SYSTEM_DEFAULTS.videoOrientation);
    expect(data.videoLengthSecs).toBe(SYSTEM_DEFAULTS.videoLengthSecs);
    expect(data.brandVoice).toBeNull();
    expect(data.defaultServiceIdForAds).toBeNull();
  });

  it('falls back to system defaults for individual nullable columns', async () => {
    // Row exists but only sets one field; the rest fall back.
    mockDb.query.orgDefaults.findFirst.mockResolvedValueOnce({
      organizationId: 'org_123',
      adDailyBudgetCents: null,
      adObjective: 'OUTCOME_AWARENESS',
      videoOrientation: null,
      videoLengthSecs: null,
      brandVoice: null,
      defaultServiceIdForAds: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const data = await expectResult(
      getOrgDefaults(mockDb as never, validInput)
    ).toSucceedWith();

    expect(data.adObjective).toBe('OUTCOME_AWARENESS');
    expect(data.adDailyBudgetCents).toBe(SYSTEM_DEFAULTS.adDailyBudgetCents);
    expect(data.videoOrientation).toBe(SYSTEM_DEFAULTS.videoOrientation);
    expect(data.videoLengthSecs).toBe(SYSTEM_DEFAULTS.videoLengthSecs);
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      getOrgDefaults(mockDb as never, {} as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.orgDefaults.findFirst).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for empty organizationId', async () => {
    await expectResult(
      getOrgDefaults(mockDb as never, { organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR when the database call throws', async () => {
    mockDb.query.orgDefaults.findFirst.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expectResult(
      getOrgDefaults(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
