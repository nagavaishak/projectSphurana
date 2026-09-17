import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { mockMetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { CampaignErrorCodes } from '../../../meta-campaigns/models/index.js';
import { AdErrorCodes } from '../../models/index.js';
import { syncAdStatus } from './sync-from-meta.service.js';

const mockGetAd = vi.mocked(mockMetaAdsService.getAd);

const mockDb = {
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  returning: vi.fn(),
  query: {
    metaAd: { findFirst: vi.fn() },
    metaAdsIntegration: { findFirst: vi.fn() },
  },
};

describe('syncAdStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(decryptCredentials).mockReturnValue({
      accessToken: 'mock-token',
    });
    mockDb.update.mockReturnValue(mockDb);
    mockDb.set.mockReturnValue(mockDb);
    mockDb.where.mockReturnValue(mockDb);
    mockDb.delete.mockReturnValue(mockDb);
    mockDb.returning.mockReset().mockResolvedValue([]);
  });

  const validInput = {
    adId: 'ad-123',
    organizationId: 'org-789',
  };

  const mockIntegration = {
    id: 'int-123',
    organizationId: 'org-789',
    configurationStatus: 'configured',
    isActive: true,
    encryptedCredentials: 'encrypted-creds',
    adAccountId: 'act_123',
    defaultPage: {
      pageId: 'page_456',
      pageName: 'Test Page',
    },
  };

  it('syncs ad status successfully', async () => {
    const mockAd = {
      id: 'ad-123',
      organizationId: 'org-789',
      metaAdId: 'meta-ad-001',
    };
    const mockMetaAd = {
      effectiveStatus: 'ACTIVE',
    };
    const mockUpdatedAd = {
      ...mockAd,
      status: 'active',
      metaStatus: 'ACTIVE',
    };

    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(mockAd);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );
    mockGetAd.mockResolvedValueOnce(mockMetaAd);
    mockDb.returning.mockResolvedValueOnce([mockUpdatedAd]);

    const result = await syncAdStatus(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('active');
      expect(result.data.metaStatus).toBe('ACTIVE');
    }
  });

  it('maps PAUSED status correctly', async () => {
    const mockAd = {
      id: 'ad-123',
      organizationId: 'org-789',
      metaAdId: 'meta-ad-001',
    };

    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(mockAd);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );
    mockGetAd.mockResolvedValueOnce({ effectiveStatus: 'PAUSED' });
    mockDb.returning.mockResolvedValueOnce([
      { ...mockAd, status: 'paused', metaStatus: 'PAUSED' },
    ]);

    const result = await syncAdStatus(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('paused');
    }
  });

  it('maps DISAPPROVED to rejected status', async () => {
    const mockAd = {
      id: 'ad-123',
      organizationId: 'org-789',
      metaAdId: 'meta-ad-001',
    };

    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(mockAd);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );
    mockGetAd.mockResolvedValueOnce({
      effectiveStatus: 'DISAPPROVED',
    });
    mockDb.returning.mockResolvedValueOnce([
      { ...mockAd, status: 'rejected', metaStatus: 'DISAPPROVED' },
    ]);

    const result = await syncAdStatus(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('rejected');
    }
  });

  it('deletes local ad when deleted on Meta', async () => {
    const mockAd = {
      id: 'ad-123',
      organizationId: 'org-789',
      metaAdId: 'meta-ad-001',
    };

    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(mockAd);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );
    mockGetAd.mockRejectedValueOnce(new Error('Ad does not exist'));
    mockDb.where.mockResolvedValueOnce(undefined);

    const result = await syncAdStatus(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(AdErrorCodes.AD_NOT_FOUND);
      expect(result.error.message).toContain('deleted');
    }
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('returns AD_NOT_FOUND when ad does not exist', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);

    const result = await syncAdStatus(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(AdErrorCodes.AD_NOT_FOUND);
    }
  });

  it('returns INVALID_AD_STATE when ad not published to Meta', async () => {
    const mockAd = {
      id: 'ad-123',
      organizationId: 'org-789',
      metaAdId: null, // Not published
    };

    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(mockAd);

    const result = await syncAdStatus(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(AdErrorCodes.INVALID_AD_STATE);
    }
  });

  it('returns AD_NOT_FOUND when organization does not match', async () => {
    const mockAd = {
      id: 'ad-123',
      organizationId: 'different-org', // Different organization
      metaAdId: 'meta-ad-001',
    };

    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(mockAd);

    const result = await syncAdStatus(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(AdErrorCodes.AD_NOT_FOUND);
    }
  });

  it('returns META_NOT_CONFIGURED when no integration', async () => {
    const mockAd = {
      id: 'ad-123',
      organizationId: 'org-789',
      metaAdId: 'meta-ad-001',
    };

    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(mockAd);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);

    const result = await syncAdStatus(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(CampaignErrorCodes.META_NOT_CONFIGURED);
    }
  });

  it('returns META_SYNC_FAILED on API error', async () => {
    const mockAd = {
      id: 'ad-123',
      organizationId: 'org-789',
      metaAdId: 'meta-ad-001',
    };

    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(mockAd);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );
    mockGetAd.mockRejectedValueOnce(new Error('API Error'));

    const result = await syncAdStatus(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(AdErrorCodes.META_SYNC_FAILED);
    }
  });

  it('returns VALIDATION_ERROR for empty adId', async () => {
    const result = await syncAdStatus(mockDb as never, {
      adId: '',
      organizationId: 'org-789',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('returns VALIDATION_ERROR for empty organizationId', async () => {
    const result = await syncAdStatus(mockDb as never, {
      adId: 'ad-123',
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('VALIDATION_ERROR');
    }
  });
});
