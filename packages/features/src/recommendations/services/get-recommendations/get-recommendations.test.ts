import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { MetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import {
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';

import { getRecommendations } from './get-recommendations.service.js';

const mockDecryptCredentials = vi.mocked(decryptCredentials);
const MockMetaAdsService = vi.mocked(MetaAdsService);

const mockDb = {
  query: {
    organizationIntegration: {
      findFirst: vi.fn(),
    },
  },
} as never;

describe('getRecommendations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      getRecommendations(mockDb, { organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for days out of range', async () => {
    await expectResult(
      getRecommendations(mockDb, { organizationId: 'org-1', days: 0 })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    await expectResult(
      getRecommendations(mockDb, { organizationId: 'org-1', days: 31 })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for limit out of range', async () => {
    await expectResult(
      getRecommendations(mockDb, { organizationId: 'org-1', limit: 0 })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    await expectResult(
      getRecommendations(mockDb, { organizationId: 'org-1', limit: 51 })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns empty recommendations when no Meta integration', async () => {
    (
      mockDb as never
    ).query.organizationIntegration.findFirst.mockResolvedValueOnce(null);

    const result = await getRecommendations(mockDb, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.recommendations).toEqual([]);
      expect(result.data.analyzedAdsCount).toBe(0);
      expect(result.data.hasMetaIntegration).toBe(false);
    }
  });

  it('returns empty recommendations when integration has no credentials', async () => {
    (
      mockDb as never
    ).query.organizationIntegration.findFirst.mockResolvedValueOnce({
      id: 'int-1',
      encryptedCredentials: null,
    });

    const result = await getRecommendations(mockDb, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hasMetaIntegration).toBe(false);
    }
  });

  it('returns INTERNAL_ERROR when credential decryption fails', async () => {
    (
      mockDb as never
    ).query.organizationIntegration.findFirst.mockResolvedValueOnce({
      id: 'int-1',
      encryptedCredentials: 'encrypted-data',
    });

    mockDecryptCredentials.mockImplementationOnce(() => {
      throw new Error('Decryption failed');
    });

    const result = await getRecommendations(mockDb, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('returns empty recommendations when no active ads', async () => {
    (
      mockDb as never
    ).query.organizationIntegration.findFirst.mockResolvedValueOnce({
      id: 'int-1',
      encryptedCredentials: 'encrypted-data',
    });

    mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'tok',
      adAccountId: 'act_123',
    } as never);

    MockMetaAdsService.mockImplementationOnce(
      () =>
        ({
          listActiveAds: vi.fn().mockResolvedValue([]),
          getAdInsightsDaily: vi.fn(),
          getAdInsights: vi.fn(),
        }) as never
    );

    const result = await getRecommendations(mockDb, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.recommendations).toEqual([]);
      expect(result.data.analyzedAdsCount).toBe(0);
      expect(result.data.hasMetaIntegration).toBe(true);
    }
  });

  it('returns INTERNAL_ERROR when Meta API throws', async () => {
    (
      mockDb as never
    ).query.organizationIntegration.findFirst.mockResolvedValueOnce({
      id: 'int-1',
      encryptedCredentials: 'encrypted-data',
    });

    mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'tok',
      adAccountId: 'act_123',
    } as never);

    MockMetaAdsService.mockImplementationOnce(
      () =>
        ({
          listActiveAds: vi.fn().mockRejectedValue(new Error('Meta API error')),
        }) as never
    );

    const result = await getRecommendations(mockDb, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
