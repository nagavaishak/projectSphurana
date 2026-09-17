import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { mockMetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { launchAdFromPost } from './launch-ad-from-post.service.js';

const mocks = {
  mockDecryptCredentials: vi.mocked(decryptCredentials),
  mockCreateAdSet: vi.mocked(mockMetaAdsService.createAdSet),
  mockListAdSets: vi.mocked(mockMetaAdsService.listAdSets),
  mockCreateAdCreativeFromPost: vi.mocked(
    mockMetaAdsService.createAdCreativeFromPost
  ),
  mockCreateAd: vi.mocked(mockMetaAdsService.createAd),
  mockUpdateCampaign: vi.mocked(mockMetaAdsService.updateCampaign),
  mockUpdateAdSet: vi.mocked(mockMetaAdsService.updateAdSet),
  mockUpdateAd: vi.mocked(mockMetaAdsService.updateAd),
  mockGetCampaign: vi.mocked(mockMetaAdsService.getCampaign),
  mockGetAdPermalink: vi.mocked(mockMetaAdsService.getAdPermalink),
  mockGetInstagramAccountInfo: vi.mocked(
    mockMetaAdsService.getInstagramAccountInfo
  ),
};

describe('launchAdFromPost', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    vi.mocked(mockMetaAdsService.getPageId).mockReturnValue('page_1');
    vi.mocked(mockMetaAdsService.hasPaymentMethod).mockResolvedValue(true);
  });

  const validInput = {
    metaCampaignId: 'campaign_1',
    socialPostId: 'post_123',
    organizationId: 'org_123',
    name: 'Test Ad',
    targeting: {
      ageMin: 18,
      ageMax: 65,
      countries: ['US'],
    },
    serviceIds: ['svc_1'],
  };

  const setupSuccessfulMocks = () => {
    mockDb.query.socialPost.findFirst.mockResolvedValueOnce({
      id: 'post_123',
      organizationId: 'org_123',
      status: 'published',
      title: 'Post Title',
      caption: 'Post caption',
      videoId: 'video_1',
      platformResults: [
        { platform: 'facebook', success: true, postId: 'page_1_post_1' },
      ],
    });
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'int_1',
      isActive: true,
      configurationStatus: 'configured',
      encryptedCredentials: 'encrypted',
      adAccountId: 'act_123',
      defaultPage: { id: 'dp_1', pageId: 'page_1', pageName: 'Test Page' },
      pages: [],
    });
    mocks.mockDecryptCredentials.mockReturnValueOnce({
      accessToken: 'token_123',
    });
    // resolveAdSet: metaCampaignConfig.findFirst returns config with adSetId
    mockDb.query.metaCampaignConfig.findFirst.mockResolvedValueOnce({
      metaAdSetId: 'adset_1',
      followUpType: 'chatbot',
    });
    mocks.mockCreateAdCreativeFromPost.mockResolvedValueOnce('creative_1');
    mocks.mockCreateAd.mockResolvedValueOnce('ad_1');
    mocks.mockUpdateCampaign.mockResolvedValueOnce(undefined);
    mocks.mockUpdateAdSet.mockResolvedValueOnce(undefined);
    mocks.mockUpdateAd.mockResolvedValueOnce(undefined);
    mocks.mockGetAdPermalink.mockResolvedValueOnce(
      'https://facebook.com/ads/ad_1'
    );
    // Insert for metaAd record
    mockDb.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'local_ad_1' }]),
      }),
    });
    // Update for metaAd (set metaStatus ACTIVE + permalink)
    mockDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
  };

  it('should launch ad from published post successfully', async () => {
    setupSuccessfulMocks();
    // For metaAdService insert
    mockDb.insert.mockReturnValueOnce({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'local_ad_1' }]),
      }),
    });

    const result = await launchAdFromPost(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metaCampaignId).toBe('campaign_1');
      expect(result.data.metaAdSetId).toBe('adset_1');
    }
  });

  it('should return error when post not found', async () => {
    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(null);

    const result = await launchAdFromPost(mockDb as never, validInput);

    expect(result.success).toBe(false);
  });

  it('should return error when post not published', async () => {
    mockDb.query.socialPost.findFirst.mockResolvedValueOnce({
      id: 'post_123',
      organizationId: 'org_123',
      status: 'draft',
      platformResults: [],
    });

    const result = await launchAdFromPost(mockDb as never, validInput);

    expect(result.success).toBe(false);
  });

  it('should return error when post has no Meta post ID', async () => {
    mockDb.query.socialPost.findFirst.mockResolvedValueOnce({
      id: 'post_123',
      organizationId: 'org_123',
      status: 'published',
      platformResults: [{ platform: 'facebook', success: false }],
    });

    const result = await launchAdFromPost(mockDb as never, validInput);

    expect(result.success).toBe(false);
  });

  it('should return error when Meta integration not configured', async () => {
    mockDb.query.socialPost.findFirst.mockResolvedValueOnce({
      id: 'post_123',
      organizationId: 'org_123',
      status: 'published',
      platformResults: [
        { platform: 'facebook', success: true, postId: 'fb_post_1' },
      ],
    });
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);

    const result = await launchAdFromPost(mockDb as never, validInput);

    expect(result.success).toBe(false);
  });

  it('should not pass asset_feed_spec for OUTCOME_LEADS chatbot', async () => {
    setupSuccessfulMocks();
    mocks.mockGetCampaign.mockResolvedValueOnce({
      id: 'campaign_1',
      objective: 'OUTCOME_LEADS',
    });
    mockDb.insert.mockReturnValueOnce({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'local_ad_1' }]),
      }),
    });

    const result = await launchAdFromPost(mockDb as never, {
      ...validInput,
      followUpType: 'chatbot',
      conversionDestination: 'messenger',
    });

    expect(result.success).toBe(true);
    // createAd should NOT have assetFeedSpec for OUTCOME_LEADS
    expect(mocks.mockCreateAd).toHaveBeenCalledWith(
      expect.objectContaining({
        assetFeedSpec: undefined,
      })
    );
  });

  it('should pass asset_feed_spec for OUTCOME_ENGAGEMENT chatbot', async () => {
    setupSuccessfulMocks();
    mocks.mockGetCampaign.mockResolvedValueOnce({
      id: 'campaign_1',
      objective: 'OUTCOME_ENGAGEMENT',
    });
    mockDb.insert.mockReturnValueOnce({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'local_ad_1' }]),
      }),
    });

    const result = await launchAdFromPost(mockDb as never, {
      ...validInput,
      followUpType: 'chatbot',
      conversionDestination: 'messenger',
    });

    expect(result.success).toBe(true);
    // createAd SHOULD have assetFeedSpec for OUTCOME_ENGAGEMENT
    expect(mocks.mockCreateAd).toHaveBeenCalledWith(
      expect.objectContaining({
        assetFeedSpec: expect.objectContaining({
          optimization_type: 'DOF_MESSAGING_DESTINATION',
        }),
      })
    );
  });

  it('should return VALIDATION_ERROR for missing required fields', async () => {
    await expectResult(
      launchAdFromPost(mockDb as never, {
        ...validInput,
        organizationId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty serviceIds', async () => {
    await expectResult(
      launchAdFromPost(mockDb as never, {
        ...validInput,
        serviceIds: [],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
