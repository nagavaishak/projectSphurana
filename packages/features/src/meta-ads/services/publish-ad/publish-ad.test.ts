import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
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
import { CampaignErrorCodes } from '../../../meta-campaigns/models/index.js';
import { ErrorCodes } from '../../../shared/index.js';
import { AdErrorCodes } from '../../models/index.js';
import {
  installMetaAdsSharedSpies,
  metaAdsSharedMocks,
  restoreMetaAdsSharedSpies,
} from '../_shared/__fixtures__/shared-spies.js';

// `_shared` is controlled with RESTORED spies, not `vi.mock` — under
// `isolate: false` a bare factory here deleted every export it omitted from the
// shared worker module graph, breaking later files (launch-ad, sync-all-ads).
// See ../_shared/__fixtures__/shared-spies.ts.
const mockShared = metaAdsSharedMocks;

import { publishAd } from './publish-ad.service.js';

const mockGetPageId = vi.mocked(mockMetaAdsService.getPageId);

describe('publishAd', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    installMetaAdsSharedSpies(
      'resolveAdSet',
      'getMetaCredentials',
      'resolveMediaAsset',
      'uploadMediaToMeta'
    );
    mockShared.resolveAdSet.mockResolvedValue({
      success: true,
      data: 'adset_123',
    });
    mockDb._resetMocks();
    vi.mocked(decryptCredentials).mockReturnValue({
      accessToken: 'mock_token',
    });
    mockGetPageId.mockReturnValue('page_123');
    // Default: credentials resolve successfully
    mockShared.getMetaCredentials.mockResolvedValue({
      success: true,
      data: {
        credentials: {
          accessToken: 'mock_token',
          adAccountId: 'act_123',
          pageId: 'page_123',
          pageName: 'Test Page',
        },
        integration: { id: 'int_1', adAccountId: 'act_123' },
        resolvedPage: {
          id: 'page-internal-1',
          pageId: 'page_123',
          pageName: 'Test Page',
          linkedInstagramAccountId: null,
          linkedInstagramUsername: null,
        },
      },
    });
  });

  afterEach(restoreMetaAdsSharedSpies);

  const validInput = {
    adId: 'ad_123',
    organizationId: 'org_123',
  };

  it('returns VALIDATION_ERROR for missing adId', async () => {
    await expectResult(
      publishAd(mockDb as never, { adId: '', organizationId: 'org_123' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns AD_NOT_FOUND when ad does not exist', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);
    await expectResult(publishAd(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(AdErrorCodes.AD_NOT_FOUND);
      }
    );
  });

  it('returns AD_NOT_FOUND when ad belongs to different org', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      id: 'ad_123',
      organizationId: 'other_org',
      status: 'draft',
    });
    await expectResult(publishAd(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(AdErrorCodes.AD_NOT_FOUND);
      }
    );
  });

  it('returns INVALID_AD_STATE when ad is not draft', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      id: 'ad_123',
      organizationId: 'org_123',
      status: 'active',
    });
    await expectResult(publishAd(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(AdErrorCodes.INVALID_AD_STATE);
      }
    );
  });

  // Other non-draft, non-error statuses stay rejected — only 'draft' and
  // 'error' (ENG-852) are retryable launch states.
  it('returns INVALID_AD_STATE for a paused ad', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      id: 'ad_123',
      organizationId: 'org_123',
      status: 'paused',
    });
    await expectResult(publishAd(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(AdErrorCodes.INVALID_AD_STATE);
      }
    );
  });

  // ENG-852: an ad left `status: 'error'` by setAdError (upload/creative
  // failure — it never reached Meta, so there's no `metaAdId`) must be
  // retryable once the owner fixes the underlying problem. Previously the
  // guard rejected anything but 'draft', so these ads were permanently stuck.
  it('allows retrying an ad stuck in error status', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      id: 'ad_123',
      name: 'Stuck ad',
      organizationId: 'org_123',
      status: 'error',
      syncError: 'Image upload to Meta did not return an image hash.',
      metaCampaignId: 'mc_1',
      metaAdId: null,
      videoId: null,
      graphicId: 'g_1',
      metaAdSetId: 'adset_1',
    });
    // Fail at the media step so we don't need the full Meta publish chain —
    // the assertion below (NOT INVALID_AD_STATE) is what proves the fix.
    mockShared.resolveMediaAsset.mockResolvedValueOnce({
      success: false,
      error: {
        code: AdErrorCodes.VIDEO_NOT_READY,
        message: 'Graphic is still rendering',
      },
    });

    await expectResult(publishAd(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(AdErrorCodes.VIDEO_NOT_READY);
      }
    );
  });

  // ENG-852 safety net: `setAdError` is ALSO called from `update-ad.service.ts`
  // when a Meta-sync push fails for an ad that is already live — that call
  // leaves `status: 'error'` WITH `metaAdId` still set. Retrying that ad here
  // must NOT go through the fresh-launch path (which calls `createAd` again
  // and would create a second live ad on Meta while the first keeps running
  // unpaused). It must fall into the existing idempotent "already live"
  // re-read branch instead, exactly like any other non-draft, has-metaAdId
  // status.
  it('treats an error-status ad that already reached Meta as already-live, not retryable-from-scratch', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      id: 'ad_123',
      name: 'Live ad whose edit failed to sync',
      organizationId: 'org_123',
      status: 'error',
      syncError: 'Failed to sync ad update to Meta',
      metaCampaignId: 'mc_1',
      metaAdId: 'meta_ad_live_1',
      videoId: null,
      graphicId: 'g_1',
      metaAdSetId: 'adset_1',
    });

    const result = await publishAd(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.alreadyLive).toBe(true);
    }
    // The dominant assertion: no second ad was created on Meta.
    expect(mockMetaAdsService.createAd).not.toHaveBeenCalled();
  });

  it('returns CAMPAIGN_NOT_FOUND when no campaign assigned', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      id: 'ad_123',
      organizationId: 'org_123',
      status: 'draft',
      metaCampaignId: null,
    });
    await expectResult(publishAd(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(AdErrorCodes.CAMPAIGN_NOT_FOUND);
      }
    );
  });

  it('returns META_NOT_CONFIGURED when integration missing', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      id: 'ad_123',
      organizationId: 'org_123',
      status: 'draft',
      metaCampaignId: 'mc_1',
      videoId: 'v_1',
      video: {
        status: 'ready',
        blobUrl: 'https://blob.test/video.mp4',
        title: 'Video',
      },
    });
    mockShared.resolveMediaAsset.mockResolvedValueOnce({
      success: true,
      data: {
        mediaBlobUrl: 'https://blob.test/video.mp4',
        mediaTitle: 'Video',
        assetType: 'video',
      },
    });
    mockShared.getMetaCredentials.mockResolvedValueOnce({
      success: false,
      error: {
        code: CampaignErrorCodes.META_NOT_CONFIGURED,
        message: 'Meta Ads integration is not configured',
      },
    });
    await expectResult(publishAd(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(CampaignErrorCodes.META_NOT_CONFIGURED);
      }
    );
  });

  it('returns VIDEO_NOT_READY when video is still processing', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      id: 'ad_123',
      organizationId: 'org_123',
      status: 'draft',
      metaCampaignId: 'mc_1',
      videoId: 'v_1',
      video: { status: 'processing', blobUrl: null, title: 'Video' },
    });
    mockShared.resolveMediaAsset.mockResolvedValueOnce({
      success: false,
      error: {
        code: AdErrorCodes.VIDEO_NOT_READY,
        message: 'Video is still processing',
      },
    });
    await expectResult(publishAd(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(AdErrorCodes.VIDEO_NOT_READY);
      }
    );
  });

  // Regression: a graphic ad has a null videoId. Previously publishAd bailed
  // here with VIDEO_NOT_FOUND ("No media attached" → 404). It must now resolve
  // the creative from graphicId instead.
  it('resolves the creative from graphicId for an image ad (no videoId)', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      id: 'ad_123',
      name: 'Graphic Ad',
      organizationId: 'org_123',
      status: 'draft',
      metaCampaignId: 'mc_1',
      videoId: null,
      graphicId: 'g_1',
      metaAdSetId: 'adset_1',
    });
    // Fail at the media step so we don't need the full Meta publish chain —
    // the assertion below is what proves the fix.
    mockShared.resolveMediaAsset.mockResolvedValueOnce({
      success: false,
      error: {
        code: AdErrorCodes.VIDEO_NOT_READY,
        message: 'Graphic is still rendering',
      },
    });

    await expectResult(publishAd(mockDb as never, validInput)).toFailWith(
      (error) => {
        // NOT VIDEO_NOT_FOUND — it got past the "no media" guard.
        expect(error.code).toBe(AdErrorCodes.VIDEO_NOT_READY);
      }
    );

    expect(mockShared.resolveMediaAsset).toHaveBeenCalledWith(
      expect.anything(),
      'g_1',
      expect.anything()
    );
  });
});
