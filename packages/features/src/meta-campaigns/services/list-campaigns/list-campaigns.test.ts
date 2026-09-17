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

import { listCampaigns } from './list-campaigns.service.js';
const mockListCampaigns = vi.mocked(mockMetaAdsService.listCampaigns);

describe('listCampaigns', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    installMetaAdsSharedSpies('getMetaCredentials');
    mockDb._resetMocks();
  });

  afterEach(restoreMetaAdsSharedSpies);

  const validInput = {
    organizationId: 'org_123',
  };

  /**
   * Helper to mock the three sequential select query chains:
   *
   * Query 1 (ad counts):  db.select({...}).from(metaAd).where(...).groupBy(...)
   * Query 2 (thumbnails): db.select({...}).from(metaAd).leftJoin(video,...).where(...).orderBy(...)
   * Query 3 (configs):    db.select().from(metaCampaignConfig).where(...)
   *
   * Since createMockDatabase doesn't include groupBy/leftJoin/orderBy as
   * top-level properties, we provide custom chains via select.mockReturnValueOnce.
   */
  const setupDbQueries = (
    adCounts: unknown[],
    configs: unknown[] = [],
    thumbnails: unknown[] = []
  ) => {
    // First select call: ad counts query (with groupBy)
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          groupBy: vi.fn().mockResolvedValue(adCounts),
        }),
      }),
    });
    // Second select call: representative thumbnail query (leftJoin + orderBy)
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(thumbnails),
          }),
        }),
      }),
    });
    // Third select call: campaign configs query
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(configs),
      }),
    });
  };

  it('should return campaigns from Meta with ad counts', async () => {
    const metaCampaigns = [
      {
        id: 'meta_camp_1',
        name: 'Campaign 1',
        objective: 'OUTCOME_LEADS',
        status: 'ACTIVE',
      },
      {
        id: 'meta_camp_2',
        name: 'Campaign 2',
        objective: 'OUTCOME_SALES',
        status: 'PAUSED',
      },
    ];

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

    mockListCampaigns.mockResolvedValueOnce(metaCampaigns);

    setupDbQueries(
      [
        { metaCampaignId: 'meta_camp_1', count: 2 },
        { metaCampaignId: 'meta_camp_2', count: 3 },
      ],
      [],
      [
        // First ad for camp_1 has no thumbnail; second one does (video).
        {
          metaCampaignId: 'meta_camp_1',
          metaThumbnailUrl: null,
          videoThumbnailUrl: null,
        },
        {
          metaCampaignId: 'meta_camp_1',
          metaThumbnailUrl: null,
          videoThumbnailUrl: 'https://cdn.example.com/video-thumb.jpg',
        },
        // camp_2 falls back to the stored Meta creative thumbnail.
        {
          metaCampaignId: 'meta_camp_2',
          metaThumbnailUrl: 'https://cdn.example.com/meta-thumb.jpg',
          videoThumbnailUrl: null,
        },
      ]
    );

    const result = await listCampaigns(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.campaigns).toHaveLength(2);
      expect(result.data.campaigns[0].adCount).toBe(2);
      expect(result.data.campaigns[1].adCount).toBe(3);
      expect(result.data.campaigns[0].previewImageUrl).toBe(
        'https://cdn.example.com/video-thumb.jpg'
      );
      expect(result.data.campaigns[1].previewImageUrl).toBe(
        'https://cdn.example.com/meta-thumb.jpg'
      );
    }
  });

  it('should set previewImageUrl to null when no ad has a thumbnail', async () => {
    const metaCampaigns = [
      {
        id: 'meta_camp_1',
        name: 'Campaign 1',
        objective: 'OUTCOME_LEADS',
        status: 'ACTIVE',
      },
    ];

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

    mockListCampaigns.mockResolvedValueOnce(metaCampaigns);

    setupDbQueries(
      [{ metaCampaignId: 'meta_camp_1', count: 1 }],
      [],
      [
        {
          metaCampaignId: 'meta_camp_1',
          metaThumbnailUrl: null,
          videoThumbnailUrl: null,
        },
      ]
    );

    const result = await listCampaigns(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.campaigns[0].previewImageUrl).toBeNull();
    }
  });

  it('should return empty array when no campaigns exist on Meta', async () => {
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

    mockListCampaigns.mockResolvedValueOnce([]);

    setupDbQueries([]);

    const result = await listCampaigns(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.campaigns).toHaveLength(0);
    }
  });

  it('should default adCount to 0 when no local ads exist for a campaign', async () => {
    const metaCampaigns = [
      {
        id: 'meta_camp_1',
        name: 'Campaign 1',
        objective: 'OUTCOME_LEADS',
        status: 'ACTIVE',
      },
    ];

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

    mockListCampaigns.mockResolvedValueOnce(metaCampaigns);

    // No ads in local DB
    setupDbQueries([]);

    const result = await listCampaigns(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.campaigns).toHaveLength(1);
      expect(result.data.campaigns[0].adCount).toBe(0);
    }
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {};

    await expectResult(
      listCampaigns(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    const invalidInput = {
      organizationId: '',
    };

    await expectResult(
      listCampaigns(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should propagate error when getMetaCredentials fails', async () => {
    mocks.mockGetMetaCredentials.mockResolvedValueOnce({
      success: false,
      error: {
        code: CampaignErrorCodes.META_NOT_CONFIGURED,
        message: 'Not configured',
      },
    });

    const result = await listCampaigns(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(CampaignErrorCodes.META_NOT_CONFIGURED);
    }
  });

  it('should return META_SYNC_FAILED when Meta API throws', async () => {
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

    mockListCampaigns.mockRejectedValueOnce(new Error('Meta API error'));

    const result = await listCampaigns(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(CampaignErrorCodes.META_SYNC_FAILED);
      expect(result.error.message).toContain('Meta API error');
    }
  });
});
