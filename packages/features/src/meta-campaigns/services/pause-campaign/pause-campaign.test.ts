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

import { pauseCampaign } from './pause-campaign.service.js';
const { mockGetMetaCredentials } = mockIntegrations;
const mockUpdateCampaign = vi.mocked(mockMetaAdsService.updateCampaign);

const mockDb = {
  query: {
    metaCampaignConfig: { findFirst: vi.fn().mockResolvedValue(null) },
  },
} as never;

describe('pauseCampaign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMetaAdsSharedSpies('getMetaCredentials');
  });

  afterEach(restoreMetaAdsSharedSpies);

  const validInput = {
    metaCampaignId: 'meta_campaign_123',
    organizationId: 'org_123',
  };

  it('should pause campaign on Meta successfully', async () => {
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
    mockUpdateCampaign.mockResolvedValueOnce(undefined);

    const result = await pauseCampaign(mockDb, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.paused).toBe(true);
    }
    expect(mockUpdateCampaign).toHaveBeenCalledWith('meta_campaign_123', {
      status: 'PAUSED',
    });
  });

  it('should return META_NOT_CONFIGURED when credentials fail', async () => {
    mockGetMetaCredentials.mockResolvedValueOnce({
      success: false,
      error: {
        code: CampaignErrorCodes.META_NOT_CONFIGURED,
        message: 'Meta Ads integration not configured.',
      },
    });

    await expectResult(pauseCampaign(mockDb, validInput)).toFailWith(
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
    mockUpdateCampaign.mockRejectedValueOnce(new Error('Meta API error'));

    await expectResult(pauseCampaign(mockDb, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(CampaignErrorCodes.META_SYNC_FAILED);
        expect(error.message).toContain('Meta API error');
      }
    );
  });

  it('should return VALIDATION_ERROR for missing metaCampaignId', async () => {
    const invalidInput = { organizationId: 'org_123' };

    await expectResult(
      pauseCampaign(mockDb, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty metaCampaignId', async () => {
    await expectResult(
      pauseCampaign(mockDb, { metaCampaignId: '', organizationId: 'org_123' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    await expectResult(
      pauseCampaign(mockDb, { metaCampaignId: 'meta_123', organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
