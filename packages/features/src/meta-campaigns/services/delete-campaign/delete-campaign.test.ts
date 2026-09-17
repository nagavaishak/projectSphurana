import { mockMetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import {
  afterEach,
  beforeEach,
  createMockDatabase,
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
const mocks = {
  mockGetMetaCredentials: metaAdsSharedMocks.getMetaCredentials,
};

import { deleteCampaign } from './delete-campaign.service.js';
const mockDeleteCampaign = vi.mocked(mockMetaAdsService.deleteCampaign);

describe('deleteCampaign', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    installMetaAdsSharedSpies('getMetaCredentials');
    mockDb._resetMocks();
  });

  afterEach(restoreMetaAdsSharedSpies);

  const validInput = {
    metaCampaignId: 'meta_campaign_123',
    organizationId: 'org_123',
  };

  it('should delete campaign successfully', async () => {
    mocks.mockGetMetaCredentials.mockResolvedValueOnce({
      success: true,
      data: {
        credentials: {
          accessToken: 'tok',
          adAccountId: 'act_123',
          pageId: 'page_1',
        },
        integration: { id: 'int-1', adAccountId: 'act_123' },
        resolvedPage: { id: 'rp-1', pageId: 'page_1', pageName: 'Test Page' },
      },
    });

    mockDeleteCampaign.mockResolvedValueOnce(undefined);

    const result = await deleteCampaign(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deleted).toBe(true);
    }
    expect(mockDeleteCampaign).toHaveBeenCalledWith('meta_campaign_123');
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('should still succeed when Meta API deletion fails (continues with local cleanup)', async () => {
    mocks.mockGetMetaCredentials.mockResolvedValueOnce({
      success: true,
      data: {
        credentials: {
          accessToken: 'tok',
          adAccountId: 'act_123',
          pageId: 'page_1',
        },
        integration: { id: 'int-1', adAccountId: 'act_123' },
        resolvedPage: { id: 'rp-1', pageId: 'page_1', pageName: 'Test Page' },
      },
    });

    mockDeleteCampaign.mockRejectedValueOnce(new Error('Meta API error'));

    const result = await deleteCampaign(mockDb as never, validInput);

    // Service catches Meta errors and continues with local cleanup
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deleted).toBe(true);
    }
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('should propagate error when getMetaCredentials fails', async () => {
    mocks.mockGetMetaCredentials.mockResolvedValueOnce({
      success: false,
      error: {
        code: CampaignErrorCodes.META_NOT_CONFIGURED,
        message: 'Not configured',
      },
    });

    const result = await deleteCampaign(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(CampaignErrorCodes.META_NOT_CONFIGURED);
    }
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing metaCampaignId', async () => {
    const invalidInput = {
      organizationId: 'org_123',
    };

    await expectResult(
      deleteCampaign(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      metaCampaignId: 'meta_campaign_123',
    };

    await expectResult(
      deleteCampaign(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty metaCampaignId', async () => {
    const invalidInput = {
      metaCampaignId: '',
      organizationId: 'org_123',
    };

    await expectResult(
      deleteCampaign(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.delete).not.toHaveBeenCalled();
  });
});
