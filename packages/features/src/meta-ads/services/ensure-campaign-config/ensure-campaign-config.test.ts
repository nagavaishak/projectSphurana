import { drizzleUniqueViolation } from '@borradh-workspace/database';
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { mockMetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import {
  backfillCampaignConfigs,
  ensureCampaignConfig,
} from './ensure-campaign-config.service.js';

const mockListAdSets = vi.mocked(mockMetaAdsService.listAdSets);
const mockGetAdSetDetails = vi.mocked(mockMetaAdsService.getAdSetDetails);
const mockListCampaigns = vi.mocked(mockMetaAdsService.listCampaigns);

const mockDb = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  query: {
    metaAdsIntegration: { findFirst: vi.fn() },
    metaCampaignConfig: { findFirst: vi.fn() },
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

describe('ensureCampaignConfig', () => {
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

  it('is a no-op when a config row already exists', async () => {
    mockDb.query.metaCampaignConfig.findFirst.mockResolvedValueOnce({
      id: 'cfg-1',
    });

    const result = await ensureCampaignConfig(mockDb as never, {
      organizationId: 'org-1',
      metaCampaignId: 'camp-1',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.created).toBe(false);
    expect(mockListAdSets).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('treats a concurrent-insert race (unique violation) as a no-op, not an error', async () => {
    mockDb.query.metaCampaignConfig.findFirst.mockResolvedValueOnce(null);
    mockListAdSets.mockResolvedValueOnce([
      { id: 'as-1', effectiveStatus: 'ACTIVE' },
    ]);
    mockGetAdSetDetails.mockResolvedValueOnce({
      id: 'as-1',
      name: 'Ad set',
      destinationType: 'MESSENGER',
    });
    mockDb.values.mockRejectedValueOnce(
      drizzleUniqueViolation('meta_campaign_config_meta_campaign_id_unique')
    );

    const result = await ensureCampaignConfig(mockDb as never, {
      organizationId: 'org-1',
      metaCampaignId: 'camp-1',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.created).toBe(false);
  });

  it('infers chatbot follow-up from a messaging ad set', async () => {
    mockDb.query.metaCampaignConfig.findFirst.mockResolvedValueOnce(null);
    mockListAdSets.mockResolvedValueOnce([
      { id: 'as-1', effectiveStatus: 'ACTIVE' },
    ]);
    mockGetAdSetDetails.mockResolvedValueOnce({
      id: 'as-1',
      name: 'Ad set',
      destinationType: 'MESSENGER',
      targeting: {
        age_min: 25,
        age_max: 45,
        geo_locations: { countries: ['IE'] },
      },
    });

    const result = await ensureCampaignConfig(mockDb as never, {
      organizationId: 'org-1',
      metaCampaignId: 'camp-1',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.created).toBe(true);
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        metaCampaignId: 'camp-1',
        followUpType: 'chatbot',
        destinationType: 'MESSENGER',
        metaAdSetId: 'as-1',
        targeting: expect.objectContaining({
          ageMin: 25,
          ageMax: 45,
          countries: ['IE'],
        }),
      })
    );
  });

  it('infers lead_form follow-up from a lead-gen ad set', async () => {
    mockDb.query.metaCampaignConfig.findFirst.mockResolvedValueOnce(null);
    mockListAdSets.mockResolvedValueOnce([
      { id: 'as-2', effectiveStatus: 'ACTIVE' },
    ]);
    mockGetAdSetDetails.mockResolvedValueOnce({
      id: 'as-2',
      name: 'Lead set',
      destinationType: 'ON_AD',
      optimizationGoal: 'LEAD_GENERATION',
    });

    const result = await ensureCampaignConfig(mockDb as never, {
      organizationId: 'org-1',
      metaCampaignId: 'camp-2',
    });

    expect(result.success).toBe(true);
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ followUpType: 'lead_form' })
    );
  });

  it('returns META_NOT_CONFIGURED when no integration exists', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);

    const result = await ensureCampaignConfig(mockDb as never, {
      organizationId: 'org-1',
      metaCampaignId: 'camp-1',
    });

    expect(result.success).toBe(false);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});

describe('backfillCampaignConfigs', () => {
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
    mockListAdSets.mockResolvedValue([
      { id: 'as-1', effectiveStatus: 'ACTIVE' },
    ]);
    mockGetAdSetDetails.mockResolvedValue({
      id: 'as-1',
      name: 'Ad set',
      destinationType: 'MESSENGER',
    });
  });

  it('creates config only for campaigns missing one', async () => {
    mockListCampaigns.mockResolvedValueOnce([
      { id: 'camp-1' },
      { id: 'camp-2' },
    ] as never);
    // camp-1 already has config, camp-2 does not.
    mockDb.query.metaCampaignConfig.findFirst
      .mockResolvedValueOnce({ id: 'cfg-1' })
      .mockResolvedValueOnce(null);

    const result = await backfillCampaignConfigs(mockDb as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scanned).toBe(2);
      expect(result.data.created).toBe(1);
    }
  });
});
