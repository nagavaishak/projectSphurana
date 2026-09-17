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

import { MetaAdsService } from '@borradh-workspace/integrations/meta-ads';

// `meta-campaigns/services/_shared` re-exports `getMetaCredentials` from
// `meta-ads/services/_shared`. It is controlled with a RESTORED spy from the
// canonical fixture, not `vi.mock` — under `pool: 'threads'` + `isolate: false`
// a bare factory persists on the shared worker module graph and DELETES every
// export it omits for the rest of the run. See the MAINTENANCE RULE in
// vite.config.ts.
const mocks = {
  mockGetMetaCredentials: metaAdsSharedMocks.getMetaCredentials,
};

import { updateCampaign } from './update-campaign.service.js';
const { mockGetMetaCredentials } = mocks;
const MockMetaAdsService = vi.mocked(MetaAdsService);

const mockDb = {
  query: {
    metaCampaignConfig: { findFirst: vi.fn().mockResolvedValue(null) },
  },
} as never;

describe('updateCampaign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMetaAdsSharedSpies('getMetaCredentials');
  });

  afterEach(restoreMetaAdsSharedSpies);

  it('returns VALIDATION_ERROR for missing metaCampaignId', async () => {
    await expectResult(
      updateCampaign(mockDb, {
        metaCampaignId: '',
        organizationId: 'org-1',
        name: 'Test',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      updateCampaign(mockDb, {
        metaCampaignId: 'camp-1',
        organizationId: '',
        name: 'Test',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR when no fields to update', async () => {
    const result = await updateCampaign(mockDb, {
      metaCampaignId: 'camp-1',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(result.error.message).toContain('At least one field');
    }
  });

  it('returns VALIDATION_ERROR for dailyBudget below minimum', async () => {
    await expectResult(
      updateCampaign(mockDb, {
        metaCampaignId: 'camp-1',
        organizationId: 'org-1',
        dailyBudget: 50,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('propagates error when getMetaCredentials fails', async () => {
    mockGetMetaCredentials.mockResolvedValueOnce({
      success: false,
      error: {
        code: CampaignErrorCodes.META_NOT_CONFIGURED,
        message: 'Not configured',
      },
    } as never);

    const result = await updateCampaign(mockDb, {
      metaCampaignId: 'camp-1',
      organizationId: 'org-1',
      name: 'Updated Name',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(CampaignErrorCodes.META_NOT_CONFIGURED);
    }
  });

  it('updates campaign name on Meta successfully', async () => {
    mockGetMetaCredentials.mockResolvedValueOnce({
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
    } as never);

    const mockUpdate = vi.fn().mockResolvedValueOnce(undefined);
    MockMetaAdsService.mockImplementationOnce(
      () =>
        ({
          updateCampaign: mockUpdate,
        }) as never
    );

    const result = await updateCampaign(mockDb, {
      metaCampaignId: 'camp-1',
      organizationId: 'org-1',
      name: 'Updated Name',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.updated).toBe(true);
    }
    expect(mockUpdate).toHaveBeenCalledWith('camp-1', { name: 'Updated Name' });
  });

  it('updates campaign dailyBudget on Meta successfully', async () => {
    mockGetMetaCredentials.mockResolvedValueOnce({
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
    } as never);

    const mockUpdate = vi.fn().mockResolvedValueOnce(undefined);
    MockMetaAdsService.mockImplementationOnce(
      () =>
        ({
          updateCampaign: mockUpdate,
        }) as never
    );

    const result = await updateCampaign(mockDb, {
      metaCampaignId: 'camp-1',
      organizationId: 'org-1',
      dailyBudget: 500,
    });

    expect(result.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith('camp-1', { dailyBudget: 500 });
  });

  it('returns META_SYNC_FAILED when Meta API throws', async () => {
    mockGetMetaCredentials.mockResolvedValueOnce({
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
    } as never);

    MockMetaAdsService.mockImplementationOnce(
      () =>
        ({
          updateCampaign: vi
            .fn()
            .mockRejectedValueOnce(new Error('Meta API error')),
        }) as never
    );

    const result = await updateCampaign(mockDb, {
      metaCampaignId: 'camp-1',
      organizationId: 'org-1',
      name: 'Test',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(CampaignErrorCodes.META_SYNC_FAILED);
    }
  });
});
