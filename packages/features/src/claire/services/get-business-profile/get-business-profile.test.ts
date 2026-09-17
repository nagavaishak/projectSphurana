import type { BusinessProfile } from '@borradh-workspace/database';
import { describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { getBusinessProfile } from './get-business-profile.service.js';

const makeProfile = (): BusinessProfile =>
  ({
    id: 'bp_1',
    organizationId: 'org_1',
    vertical: 'aesthetic_clinic',
    retentionModel: 'course_based',
    commitmentLevel: 'planned',
    marketPosition: 'at',
    axesConfidence: 0.9,
    axesReasoning: 'mock',
    classifierAxes: null,
    overriddenAxes: null,
    disagreement: null,
    rankedServices: [],
    inputHash: 'h',
    classifiedAt: new Date(),
    classifierVersion: 'aesthetic_clinic@v1',
    verticalMetadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as BusinessProfile;

const buildMockDb = (profile: BusinessProfile | null) => ({
  query: {
    businessProfile: {
      findFirst: vi.fn().mockResolvedValue(profile),
    },
  },
});

describe('getBusinessProfile', () => {
  it('returns VALIDATION_ERROR for empty organizationId', async () => {
    const db = buildMockDb(null);
    const result = await getBusinessProfile(db as never, {
      organizationId: '',
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns NOT_FOUND when no profile exists', async () => {
    const db = buildMockDb(null);
    const result = await getBusinessProfile(db as never, {
      organizationId: 'org_missing',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('returns the profile when found', async () => {
    const profile = makeProfile();
    const db = buildMockDb(profile);
    const result = await getBusinessProfile(db as never, {
      organizationId: 'org_1',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.id).toBe('bp_1');
  });
});
