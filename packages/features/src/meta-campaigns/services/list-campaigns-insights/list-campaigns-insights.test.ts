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

// `@borradh-workspace/integrations/meta-ads` is canonically aliased to
// src/__mocks__/integrations-meta-ads.ts. It used to be `vi.mock`ed here with a
// bare factory exporting only `MetaAdsService`, which under `isolate: false`
// deleted `mockMetaAdsService` / `MetaOAuthService` / `MetaAppSecretMismatchError`
// from the shared worker graph. Drive the canonical stable instance instead.
const mockGetAccountCampaignInsights = vi.mocked(
  mockMetaAdsService.getAccountCampaignInsights
);

// `meta-campaigns/services/_shared` re-exports `getMetaCredentials` from
// `meta-ads/services/_shared`. It is controlled with a RESTORED spy from the
// canonical fixture, not `vi.mock` — under `pool: 'threads'` + `isolate: false`
// a bare factory persists on the shared worker module graph and DELETES every
// export it omits for the rest of the run. See the MAINTENANCE RULE in
// vite.config.ts.
const mockGetMetaCredentials = metaAdsSharedMocks.getMetaCredentials;

import { listCampaignsInsights } from './list-campaigns-insights.service.js';

// The service never reads from the db directly, and handleMetaError only
// touches the db on auth errors (not exercised here).
const mockDb = {} as never;

const validCredentials = {
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
};

describe('listCampaignsInsights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMetaAdsSharedSpies('getMetaCredentials');
  });

  afterEach(restoreMetaAdsSharedSpies);

  const validInput = { organizationId: 'org_123' };

  it('returns one insights entry per campaign from a single Meta call', async () => {
    mockGetMetaCredentials.mockResolvedValueOnce(validCredentials);
    mockGetAccountCampaignInsights.mockResolvedValueOnce([
      {
        campaign_id: 'camp_1',
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
      },
      { campaign_id: 'camp_2', impressions: '200', spend: '4.00' },
    ]);

    const result = await listCampaignsInsights(mockDb, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.insights).toHaveLength(2);

      const c1 = result.data.insights.find(
        (i) => i.metaCampaignId === 'camp_1'
      );
      expect(c1?.totals.impressions).toBe(1000);
      expect(c1?.totals.spend).toBe(2550); // dollars → cents
      expect(c1?.totals.leads).toBe(10);
      expect(c1?.totals.conversions).toBe(5);

      const c2 = result.data.insights.find(
        (i) => i.metaCampaignId === 'camp_2'
      );
      expect(c2?.totals.impressions).toBe(200);
      expect(c2?.totals.leads).toBe(0);
    }
    // The whole point of the batch service — one Meta request, not one per campaign.
    expect(mockGetAccountCampaignInsights).toHaveBeenCalledTimes(1);
  });

  it('passes a custom date range through to Meta', async () => {
    mockGetMetaCredentials.mockResolvedValueOnce(validCredentials);
    mockGetAccountCampaignInsights.mockResolvedValueOnce([]);

    const result = await listCampaignsInsights(mockDb, {
      ...validInput,
      dateRange: { since: '2024-01-01', until: '2024-01-31' },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dateRange).toEqual({
        since: '2024-01-01',
        until: '2024-01-31',
      });
    }
    expect(mockGetAccountCampaignInsights).toHaveBeenCalledWith({
      since: '2024-01-01',
      until: '2024-01-31',
    });
  });

  it('drops account-level rows that have no campaign_id', async () => {
    mockGetMetaCredentials.mockResolvedValueOnce(validCredentials);
    mockGetAccountCampaignInsights.mockResolvedValueOnce([
      { campaign_id: 'camp_1', impressions: '10' },
      { impressions: '999' }, // summary row — no campaign_id
    ]);

    const result = await listCampaignsInsights(mockDb, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.insights).toHaveLength(1);
      expect(result.data.insights[0].metaCampaignId).toBe('camp_1');
    }
  });

  it('returns META_NOT_CONFIGURED when credentials fail', async () => {
    mockGetMetaCredentials.mockResolvedValueOnce({
      success: false,
      error: {
        code: CampaignErrorCodes.META_NOT_CONFIGURED,
        message: 'Meta Ads integration not configured.',
      },
    });

    await expectResult(listCampaignsInsights(mockDb, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(CampaignErrorCodes.META_NOT_CONFIGURED);
      }
    );
  });

  it('returns META_SYNC_FAILED when the Meta API fails', async () => {
    mockGetMetaCredentials.mockResolvedValueOnce(validCredentials);
    mockGetAccountCampaignInsights.mockRejectedValueOnce(
      new Error('Rate limit exceeded')
    );

    await expectResult(listCampaignsInsights(mockDb, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(CampaignErrorCodes.META_SYNC_FAILED);
      }
    );
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      listCampaignsInsights(mockDb, {} as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
