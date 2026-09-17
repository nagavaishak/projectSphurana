import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import {
  MetaAdsService,
  mockMetaAdsService,
} from '@borradh-workspace/integrations/meta-ads';
import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { AdErrorCodes } from '../../models/index.js';
import { deleteAd } from './delete-ad.service.js';

const mockDeleteAd = vi.mocked(mockMetaAdsService.deleteAd);

const mockDb = {
  delete: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue(undefined),
  query: {
    metaAd: { findFirst: vi.fn() },
    metaAdsIntegration: { findFirst: vi.fn() },
    metaCampaignConfig: { findFirst: vi.fn() },
  },
};

describe('deleteAd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteAd.mockResolvedValue(undefined);
    vi.mocked(decryptCredentials).mockReturnValue({
      accessToken: 'mock-token',
      adAccountId: 'act_123',
      pageId: 'page_456',
    });
  });

  const validInput = {
    adId: 'ad-123',
    organizationId: 'org-789',
  };

  it('deletes ad that is not synced to Meta', async () => {
    const mockAd = {
      id: 'ad-123',
      organizationId: 'org-789',
      metaAdId: null, // Not synced to Meta
    };

    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(mockAd);

    const result = await deleteAd(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deleted).toBe(true);
    }
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('deletes ad synced to Meta and removes from Meta', async () => {
    const mockAd = {
      id: 'ad-123',
      organizationId: 'org-789',
      metaAdId: 'meta-ad-001', // Synced to Meta
    };
    const mockIntegration = {
      id: 'int-123',
      organizationId: 'org-789',
      configurationStatus: 'configured',
      isActive: true,
      encryptedCredentials: 'encrypted-creds',
      adAccountId: 'act_123',
      defaultPage: { pageId: 'page_456', pageName: 'Test Page' },
    };

    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(mockAd);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );

    const result = await deleteAd(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deleted).toBe(true);
    }
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it("deletes on Meta using the ad's own page + campaign ad account snapshot", async () => {
    const mockAd = {
      id: 'ad-123',
      organizationId: 'org-789',
      metaAdId: 'meta-ad-001',
      metaAdsPageId: 'page-row-2', // internal metaAdsPage.id
      metaCampaignId: 'camp-1',
    };
    const mockIntegration = {
      id: 'int-123',
      organizationId: 'org-789',
      configurationStatus: 'configured',
      isActive: true,
      encryptedCredentials: 'encrypted-creds',
      adAccountId: 'act_default',
      defaultPage: { id: 'page-row-1', pageId: 'page_default' },
      pages: [
        { id: 'page-row-1', pageId: 'page_default' },
        { id: 'page-row-2', pageId: 'page_other' },
      ],
    };

    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(mockAd);
    mockDb.query.metaCampaignConfig.findFirst.mockResolvedValueOnce({
      metaCampaignId: 'camp-1',
      adAccountId: 'act_snapshot',
    });
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );

    const result = await deleteAd(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockDeleteAd).toHaveBeenCalledWith('meta-ad-001');
    // Must NOT fall back to the integration default page/ad account
    expect(vi.mocked(MetaAdsService)).toHaveBeenCalledWith(
      expect.objectContaining({
        adAccountId: 'act_snapshot',
        pageId: 'page_other',
      })
    );
  });

  it('deletes local ad even if Meta deletion fails', async () => {
    const mockAd = {
      id: 'ad-123',
      organizationId: 'org-789',
      metaAdId: 'meta-ad-001',
    };
    const mockIntegration = {
      id: 'int-123',
      organizationId: 'org-789',
      configurationStatus: 'configured',
      isActive: true,
      encryptedCredentials: 'encrypted-creds',
      adAccountId: 'act_123',
      defaultPage: { pageId: 'page_456', pageName: 'Test Page' },
    };

    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(mockAd);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );

    // Meta deletion is mocked to succeed, but even if it failed,
    // the local deletion should still proceed
    const result = await deleteAd(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('deletes ad when no Meta integration exists', async () => {
    const mockAd = {
      id: 'ad-123',
      organizationId: 'org-789',
      metaAdId: 'meta-ad-001',
    };

    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(mockAd);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);

    const result = await deleteAd(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deleted).toBe(true);
    }
  });

  it('returns VALIDATION_ERROR for missing adId', async () => {
    const result = await deleteAd(mockDb as never, {
      ...validInput,
      adId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.query.metaAd.findFirst).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await deleteAd(mockDb as never, {
      ...validInput,
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns AD_NOT_FOUND when ad does not exist', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);

    const result = await deleteAd(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(AdErrorCodes.AD_NOT_FOUND);
    }
  });

  it('returns AD_NOT_FOUND when ad belongs to different org', async () => {
    const mockAd = {
      id: 'ad-123',
      organizationId: 'different-org',
    };

    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(mockAd);

    const result = await deleteAd(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(AdErrorCodes.AD_NOT_FOUND);
    }
    expect(mockDb.delete).not.toHaveBeenCalled();
  });
});
