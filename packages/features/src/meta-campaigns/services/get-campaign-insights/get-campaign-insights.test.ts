import { mockMetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import {
  installMetaAdsSharedSpies,
  metaAdsSharedMocks,
  restoreMetaAdsSharedSpies,
} from '../../../meta-ads/services/_shared/__fixtures__/shared-spies.js';
import { ErrorCodes } from '../../../shared/index.js';
import { CampaignErrorCodes } from '../../models/index.js';

// `meta-campaigns/services/_shared` re-exports `getMetaCredentials` from
// `meta-ads/services/_shared`. It is controlled with a RESTORED spy from the
// canonical fixture, not `vi.mock` — under `pool: 'threads'` + `isolate: false`
// a bare factory persists on the shared worker module graph and DELETES every
// export it omits for the rest of the run. See the MAINTENANCE RULE in
// vite.config.ts.
const mockIntegrations = {
  mockGetMetaCredentials: metaAdsSharedMocks.getMetaCredentials,
};

import { getCampaignInsights } from './get-campaign-insights.service.js';
const { mockGetMetaCredentials } = mockIntegrations;
const mockGetCampaignAggregateInsights = vi.mocked(
  mockMetaAdsService.getCampaignAggregateInsights
);
const mockGetCampaignInsights = vi.mocked(
  mockMetaAdsService.getCampaignInsights
);

const mockDb = {
  query: {
    metaCampaignConfig: { findFirst: vi.fn().mockResolvedValue(null) },
  },
} as never;

describe('getCampaignInsights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMetaAdsSharedSpies('getMetaCredentials');
  });

  afterEach(restoreMetaAdsSharedSpies);

  const validInput = {
    metaCampaignId: 'meta_campaign_123',
    organizationId: 'org_123',
  };

  it('should fetch insights from Meta for a campaign', async () => {
    mockGetMetaCredentials.mockResolvedValueOnce({
      success: true,
      data: {
        credentials: {
          accessToken: 'mock_token',
          adAccountId: 'act_123',
          pageId: 'page_1',
        },
        integration: { id: 'int-1', adAccountId: 'act_123' },
        resolvedPage: { id: 'rp-1', pageId: 'page_1', pageName: 'Test Page' },
      },
    });

    const aggregateInsights = {
      impressions: '1000',
      reach: '800',
      clicks: '50',
      spend: '25.50',
      cpc: '0.51',
      cpm: '25.50',
      ctr: '5.0',
      frequency: '1.25',
      actions: [
        { actionType: 'lead', value: '10' },
        { actionType: 'omni_purchase', value: '5' },
      ],
    };

    const adInsights = [
      {
        ad_id: 'ad_1',
        ad_name: 'Test Ad 1',
        impressions: '500',
        reach: '400',
        clicks: '25',
        spend: '12.75',
        cpc: '0.51',
        cpm: '25.50',
        ctr: '5.0',
      },
    ];

    mockGetCampaignAggregateInsights.mockResolvedValueOnce(aggregateInsights);
    mockGetCampaignInsights.mockResolvedValueOnce(adInsights);

    const result = await getCampaignInsights(mockDb, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metaCampaignId).toBe('meta_campaign_123');
      expect(result.data.totals.impressions).toBe(1000);
      expect(result.data.totals.reach).toBe(800);
      expect(result.data.totals.clicks).toBe(50);
      expect(result.data.totals.spend).toBe(2550); // In cents
      expect(result.data.totals.leads).toBe(10);
      expect(result.data.totals.conversions).toBe(5);
      expect(result.data.ads).toHaveLength(1);
      expect(result.data.ads[0].adId).toBe('ad_1');
      expect(result.data.ads[0].adName).toBe('Test Ad 1');
    }
  });

  it('should use custom date range when provided', async () => {
    const inputWithDateRange = {
      ...validInput,
      dateRange: {
        since: '2024-01-01',
        until: '2024-01-31',
      },
    };

    mockGetMetaCredentials.mockResolvedValueOnce({
      success: true,
      data: {
        credentials: {
          accessToken: 'mock_token',
          adAccountId: 'act_123',
          pageId: 'page_1',
        },
        integration: { id: 'int-1', adAccountId: 'act_123' },
        resolvedPage: { id: 'rp-1', pageId: 'page_1', pageName: 'Test Page' },
      },
    });
    mockGetCampaignAggregateInsights.mockResolvedValueOnce({});
    mockGetCampaignInsights.mockResolvedValueOnce([]);

    const result = await getCampaignInsights(mockDb, inputWithDateRange);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dateRange.since).toBe('2024-01-01');
      expect(result.data.dateRange.until).toBe('2024-01-31');
    }
    expect(mockGetCampaignAggregateInsights).toHaveBeenCalledWith(
      'meta_campaign_123',
      { since: '2024-01-01', until: '2024-01-31' }
    );
  });

  it('should return META_NOT_CONFIGURED when credentials fail', async () => {
    mockGetMetaCredentials.mockResolvedValueOnce({
      success: false,
      error: {
        code: CampaignErrorCodes.META_NOT_CONFIGURED,
        message: 'Meta Ads integration not configured.',
      },
    });

    await expectResult(getCampaignInsights(mockDb, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(CampaignErrorCodes.META_NOT_CONFIGURED);
      }
    );
  });

  it('should return META_SYNC_FAILED when Meta API fails', async () => {
    mockGetMetaCredentials.mockResolvedValueOnce({
      success: true,
      data: {
        credentials: {
          accessToken: 'mock_token',
          adAccountId: 'act_123',
          pageId: 'page_1',
        },
        integration: { id: 'int-1', adAccountId: 'act_123' },
        resolvedPage: { id: 'rp-1', pageId: 'page_1', pageName: 'Test Page' },
      },
    });
    mockGetCampaignAggregateInsights.mockRejectedValueOnce(
      new Error('Rate limit exceeded')
    );

    await expectResult(getCampaignInsights(mockDb, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(CampaignErrorCodes.META_SYNC_FAILED);
        expect(error.message).toContain('Rate limit exceeded');
      }
    );
  });

  it('should handle null/undefined values in insights gracefully', async () => {
    mockGetMetaCredentials.mockResolvedValueOnce({
      success: true,
      data: {
        credentials: {
          accessToken: 'mock_token',
          adAccountId: 'act_123',
          pageId: 'page_1',
        },
        integration: { id: 'int-1', adAccountId: 'act_123' },
        resolvedPage: { id: 'rp-1', pageId: 'page_1', pageName: 'Test Page' },
      },
    });

    // API returns nulls/undefined for some fields
    const aggregateInsights = {
      impressions: undefined,
      clicks: null,
      spend: '',
    };

    mockGetCampaignAggregateInsights.mockResolvedValueOnce(aggregateInsights);
    mockGetCampaignInsights.mockResolvedValueOnce([]);

    const result = await getCampaignInsights(mockDb, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totals.impressions).toBe(0);
      expect(result.data.totals.clicks).toBe(0);
      expect(result.data.totals.spend).toBe(0);
    }
  });

  it('should return VALIDATION_ERROR for missing metaCampaignId', async () => {
    const invalidInput = { organizationId: 'org_123' };

    await expectResult(
      getCampaignInsights(mockDb, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
