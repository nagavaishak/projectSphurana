import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { mockMetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { AdErrorCodes } from '../../models/index.js';
import { duplicateAd } from './duplicate-ad.service.js';

const mockCopyAd = vi.mocked(mockMetaAdsService.copyAd);
const mockGetAd = vi.mocked(mockMetaAdsService.getAd);

const mockDb = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn(),
  query: {
    metaAd: { findFirst: vi.fn() },
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

const baseSource = {
  id: 'ad-src',
  organizationId: 'org-1',
  metaCampaignId: 'camp-1',
  metaAdSetId: 'as-1',
  name: 'My Ad',
  headline: 'Hi',
  primaryText: 'Body',
  description: null,
  callToAction: 'LEARN_MORE',
  destinationUrl: null,
  followUpType: 'lead_form',
  leadFormId: null,
  sequenceId: null,
  adPlacement: 'facebook',
  conversionDestination: null,
  destinations: null,
  targetingOverride: null,
  metaAdsPageId: 'page-internal-1',
  adAccountId: 'act_123',
  socialPostId: null,
  useExistingPost: false,
  metaThumbnailUrl: null,
  services: [{ serviceId: 'svc-1' }],
};

describe('duplicateAd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue(mockDb);
    mockDb.values.mockReturnValue(mockDb);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValue(integration);
    vi.mocked(decryptCredentials).mockReturnValue({
      accessToken: 'tok',
      adAccountId: 'act_123',
      pageId: 'page_456',
    });
  });

  it('returns AD_NOT_FOUND when the ad does not exist', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);

    const result = await duplicateAd(mockDb as never, {
      adId: 'missing',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(AdErrorCodes.AD_NOT_FOUND);
  });

  it('recreates a draft ad without touching Meta', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      ...baseSource,
      metaAdId: null,
      videoId: 'vid-1',
      graphicId: null,
    });
    mockDb.returning.mockResolvedValueOnce([
      { id: 'ad-copy', status: 'draft' },
    ]);

    const result = await duplicateAd(mockDb as never, {
      adId: 'ad-src',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    expect(mockCopyAd).not.toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'My Ad (Copy)', status: 'draft' })
    );
  });

  it('clones a launched Borradh ad as a draft (no Meta copy, not imported)', async () => {
    // Has a local creative (videoId) AND a metaAdId — must NOT round-trip
    // through Meta's /copies (which would re-validate the creative + flag it
    // imported); clone the local row as a draft instead.
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      ...baseSource,
      metaAdId: 'meta-ad-src',
      videoId: 'vid-1',
      graphicId: null,
    });
    mockDb.returning.mockResolvedValueOnce([
      { id: 'ad-copy', status: 'draft' },
    ]);

    const result = await duplicateAd(mockDb as never, {
      adId: 'ad-src',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    expect(mockCopyAd).not.toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'My Ad (Copy)',
        status: 'draft',
        isImported: false,
        videoId: 'vid-1',
      })
    );
  });

  it('copies an imported ad (no local creative) on Meta, paused', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      ...baseSource,
      metaAdId: 'meta-ad-src',
      videoId: null,
      graphicId: null,
      socialPostId: null,
    });
    mockCopyAd.mockResolvedValueOnce({ copiedAdId: 'meta-ad-copy' });
    mockGetAd.mockResolvedValueOnce({
      id: 'meta-ad-copy',
      name: 'My Ad (Copy)',
      status: 'PAUSED',
      effectiveStatus: 'PAUSED',
    } as never);
    mockDb.returning.mockResolvedValueOnce([{ id: 'ad-copy' }]);

    const result = await duplicateAd(mockDb as never, {
      adId: 'ad-src',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    expect(mockCopyAd).toHaveBeenCalledWith(
      'meta-ad-src',
      expect.objectContaining({ statusOption: 'PAUSED', adSetId: 'as-1' })
    );
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        metaAdId: 'meta-ad-copy',
        isImported: true,
        name: 'My Ad (Copy)',
      })
    );
  });
});
