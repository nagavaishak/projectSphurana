import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { mockMetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { duplicateCampaign } from './duplicate-campaign.service.js';

const mockCopyCampaign = vi.mocked(mockMetaAdsService.copyCampaign);
const mockCopyAdSet = vi.mocked(mockMetaAdsService.copyAdSet);
const mockCopyAd = vi.mocked(mockMetaAdsService.copyAd);
const mockListAdSets = vi.mocked(mockMetaAdsService.listAdSets);
const mockListCampaignAds = vi.mocked(
  mockMetaAdsService.listCampaignAdsWithCreative
);

const mockDb = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  onConflictDoUpdate: vi.fn().mockReturnThis(),
  returning: vi.fn(),
  query: {
    metaAd: { findFirst: vi.fn(), findMany: vi.fn() },
    metaCampaignConfig: { findFirst: vi.fn() },
    metaAdsIntegration: { findFirst: vi.fn() },
  },
};

const integration = {
  id: 'int-1',
  encryptedCredentials: 'enc',
  adAccountId: 'act_123',
  configurationStatus: 'configured',
  isActive: true,
  defaultPage: {
    id: 'page-internal-1',
    pageId: 'page_456',
    pageName: 'Test Page',
    defaultAdAccountId: 'act_123',
    defaultAdAccountCurrency: 'USD',
  },
  pages: [],
};

const sourceConfig = {
  id: 'cfg-1',
  organizationId: 'org-1',
  metaCampaignId: 'camp-1',
  metaAdsPageId: 'page-internal-1',
  adAccountId: 'act_123',
  adAccountCurrency: 'USD',
  followUpType: 'lead_form',
  conversionDestination: null,
  destinationType: null,
  leadFormId: 'lf-1',
  locationId: null,
  targeting: null,
};

describe('duplicateCampaign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue(mockDb);
    mockDb.values.mockReturnValue(mockDb);
    mockDb.onConflictDoUpdate.mockReturnValue(mockDb);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValue(integration);
    mockDb.query.metaAd.findMany.mockResolvedValue([]);
    mockDb.query.metaAd.findFirst.mockResolvedValue(null);
    vi.mocked(decryptCredentials).mockReturnValue({
      accessToken: 'tok',
      adAccountId: 'act_123',
      pageId: 'page_456',
    });
  });

  it('returns CAMPAIGN_NOT_FOUND when no config can be resolved', async () => {
    mockDb.query.metaCampaignConfig.findFirst.mockResolvedValue(null);
    mockListAdSets.mockResolvedValue([]);

    const result = await duplicateCampaign(mockDb as never, {
      metaCampaignId: 'camp-1',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('CAMPAIGN_NOT_FOUND');
    expect(mockCopyCampaign).not.toHaveBeenCalled();
  });

  it('rebuilds the campaign object-by-object (campaign, ad sets, ads), paused', async () => {
    // 1st findFirst: ensure existing-check → already exists (no-op).
    // 2nd findFirst: sourceConfig read.
    mockDb.query.metaCampaignConfig.findFirst
      .mockResolvedValueOnce({ id: 'cfg-1' })
      .mockResolvedValueOnce(sourceConfig);

    mockCopyCampaign.mockResolvedValueOnce({
      copiedCampaignId: 'camp-copy',
      adObjectIds: [],
    });
    mockListAdSets.mockResolvedValueOnce([
      { id: 'as-src', effectiveStatus: 'ACTIVE' },
    ]);
    mockCopyAdSet.mockResolvedValueOnce({ copiedAdSetId: 'as-new' });
    mockListCampaignAds.mockResolvedValueOnce([
      {
        id: 'meta-ad-src',
        name: 'Ad',
        effectiveStatus: 'PAUSED',
        adsetId: 'as-src',
        creative: { id: 'cr1', title: 't', callToActionType: 'LEARN_MORE' },
      },
    ] as never);
    mockCopyAd.mockResolvedValueOnce({ copiedAdId: 'meta-ad-new' });
    mockDb.returning.mockResolvedValueOnce([{ id: 'local-ad-1' }]);

    const result = await duplicateCampaign(mockDb as never, {
      metaCampaignId: 'camp-1',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metaCampaignId).toBe('camp-copy');
      expect(result.data.metaAdSetId).toBe('as-new');
      expect(result.data.adsCopied).toBe(1);
    }
    // Shallow campaign copy (avoids the 3-object sync limit)
    expect(mockCopyCampaign).toHaveBeenCalledWith(
      'camp-1',
      expect.objectContaining({ deepCopy: false, statusOption: 'PAUSED' })
    );
    // Ad set copied into the new campaign
    expect(mockCopyAdSet).toHaveBeenCalledWith(
      'as-src',
      expect.objectContaining({ campaignId: 'camp-copy' })
    );
    // Ad copied into the mapped new ad set
    expect(mockCopyAd).toHaveBeenCalledWith(
      'meta-ad-src',
      expect.objectContaining({ adSetId: 'as-new', statusOption: 'PAUSED' })
    );
    // Config cloned + local ad row written
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        metaCampaignId: 'camp-copy',
        followUpType: 'lead_form',
        metaAdSetId: 'as-new',
      })
    );
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ metaAdId: 'meta-ad-new', isImported: true })
    );
  });
});
