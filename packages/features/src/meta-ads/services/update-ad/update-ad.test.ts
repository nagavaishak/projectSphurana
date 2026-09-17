import { mockMetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { AdErrorCodes } from '../../models/index.js';
import {
  installMetaAdsSharedSpies,
  metaAdsSharedMocks,
  restoreMetaAdsSharedSpies,
} from '../_shared/__fixtures__/shared-spies.js';

// NOTE: no `vi.mock('@borradh-workspace/integrations')` here. That specifier is
// canonically aliased (exact-match RegExp) to src/__mocks__/integrations.ts, and
// under `isolate: false` a file-local factory persists on the shared worker
// module graph — this one exported ONLY `getMetaErrorMessage` and so stripped
// every other integration export for any later test file. The canonical mock
// re-exports the REAL `getMetaErrorMessage` (pure logic over the Meta error
// registry), so the service simply gets the genuine message off the thrown
// error — asserted below.

// Same hazard for `../_shared/index.js`: a bare `vi.mock` factory here exported
// only 4 of its ~20 symbols and deleted the rest for every later file. It is now
// controlled with RESTORED spies from the canonical fixture, so the module keeps
// its full export surface outside this file.
const mocks = {
  mockGetMetaCredentials: metaAdsSharedMocks.getMetaCredentials,
  mockHandleMetaError: metaAdsSharedMocks.handleMetaError,
  mockSetAdError: metaAdsSharedMocks.setAdError,
  mockBuildAdCreative: metaAdsSharedMocks.buildAdCreative,
};

import { updateAd } from './update-ad.service.js';

const mockCreateAdCreative = vi.mocked(mockMetaAdsService.createAdCreative);
const mockCreateAdCreativeFromImage = vi.mocked(
  mockMetaAdsService.createAdCreativeFromImage
);
const mockUpdateAd = vi.mocked(mockMetaAdsService.updateAd);
const mockGetPageId = vi.mocked(mockMetaAdsService.getPageId);

const mockDb = {
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  returning: vi.fn(),
  query: {
    metaAd: { findFirst: vi.fn() },
    metaCampaignConfig: { findFirst: vi.fn() },
  },
};

describe('updateAd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMetaAdsSharedSpies(
      'getMetaCredentials',
      'handleMetaError',
      'setAdError',
      'buildAdCreative'
    );
    mockGetPageId.mockReturnValue('page-123');
    mocks.mockGetMetaCredentials.mockResolvedValue({
      success: true,
      data: {
        credentials: {
          accessToken: 'token',
          adAccountId: 'act_123',
          pageId: 'page-123',
        },
        resolvedPage: {
          id: 'page-internal-1',
          pageId: 'page-123',
          pageName: 'Test Page',
          linkedInstagramAccountId: null,
        },
      },
    });
    mocks.mockHandleMetaError.mockReturnValue({
      success: false,
      error: { code: ErrorCodes.INTERNAL_ERROR, message: 'Meta sync failed' },
    });
    // Creative rebuild now goes through the shared buildAdCreative builder.
    mocks.mockBuildAdCreative.mockResolvedValue({
      success: true,
      data: { creativeId: 'new-creative-555' },
    });
  });

  afterEach(restoreMetaAdsSharedSpies);

  const validInput = {
    adId: 'ad-123',
    organizationId: 'org-789',
    name: 'Updated Ad Name',
    headline: 'New Headline',
  };

  // --- Existing tests (draft ads, DB-only) ---

  it('updates ad with valid input', async () => {
    const mockAd = {
      id: 'ad-123',
      organizationId: 'org-789',
      name: 'Old Name',
      status: 'draft',
    };
    const updatedAd = {
      ...mockAd,
      name: 'Updated Ad Name',
      headline: 'New Headline',
    };

    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(mockAd);
    mockDb.returning.mockResolvedValueOnce([updatedAd]);

    const result = await updateAd(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Updated Ad Name');
      expect(result.data.headline).toBe('New Headline');
    }
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('updates only provided fields', async () => {
    const mockAd = {
      id: 'ad-123',
      organizationId: 'org-789',
      name: 'Old Name',
      headline: 'Old Headline',
      status: 'draft',
    };
    const partialInput = {
      adId: 'ad-123',
      organizationId: 'org-789',
      headline: 'Only Headline Updated',
    };

    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(mockAd);
    mockDb.returning.mockResolvedValueOnce([
      { ...mockAd, headline: 'Only Headline Updated' },
    ]);

    const result = await updateAd(mockDb as never, partialInput);

    expect(result.success).toBe(true);
    expect(mockDb.set).toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing adId', async () => {
    const result = await updateAd(mockDb as never, {
      ...validInput,
      adId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.query.metaAd.findFirst).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await updateAd(mockDb as never, {
      ...validInput,
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns AD_NOT_FOUND when ad does not exist', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);

    const result = await updateAd(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(AdErrorCodes.AD_NOT_FOUND);
    }
  });

  it('returns AD_NOT_FOUND when ad belongs to different org', async () => {
    const mockAd = {
      id: 'ad-123',
      organizationId: 'different-org',
    };

    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(mockAd);

    const result = await updateAd(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(AdErrorCodes.AD_NOT_FOUND);
    }
  });

  it('returns INVALID_AD_STATE when ad is rejected', async () => {
    const mockAd = {
      id: 'ad-123',
      organizationId: 'org-789',
      status: 'rejected',
    };

    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(mockAd);

    const result = await updateAd(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(AdErrorCodes.INVALID_AD_STATE);
      expect(result.error.message).toContain('rejected');
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('updates ad call to action', async () => {
    const mockAd = {
      id: 'ad-123',
      organizationId: 'org-789',
      status: 'draft',
      callToAction: 'LEARN_MORE',
    };
    const inputWithCta = {
      adId: 'ad-123',
      organizationId: 'org-789',
      callToAction: 'SHOP_NOW' as const,
    };

    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(mockAd);
    mockDb.returning.mockResolvedValueOnce([
      { ...mockAd, callToAction: 'SHOP_NOW' },
    ]);

    const result = await updateAd(mockDb as never, inputWithCta);

    expect(result.success).toBe(true);
  });

  it('updates destination URL', async () => {
    const mockAd = {
      id: 'ad-123',
      organizationId: 'org-789',
      status: 'draft',
    };
    const inputWithUrl = {
      adId: 'ad-123',
      organizationId: 'org-789',
      destinationUrl: 'https://newsite.com',
    };

    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(mockAd);
    mockDb.returning.mockResolvedValueOnce([
      { ...mockAd, destinationUrl: 'https://newsite.com' },
    ]);

    const result = await updateAd(mockDb as never, inputWithUrl);

    expect(result.success).toBe(true);
  });

  it('updates targeting override', async () => {
    const mockAd = {
      id: 'ad-123',
      organizationId: 'org-789',
      status: 'draft',
    };
    const inputWithTargeting = {
      adId: 'ad-123',
      organizationId: 'org-789',
      targetingOverride: {
        ageMin: 25,
        ageMax: 55,
      },
    };

    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(mockAd);
    mockDb.returning.mockResolvedValueOnce([
      { ...mockAd, targetingOverride: { ageMin: 25, ageMax: 55 } },
    ]);

    const result = await updateAd(mockDb as never, inputWithTargeting);

    expect(result.success).toBe(true);
  });

  // --- Meta sync tests (published ads) ---

  describe('Meta sync for published ads', () => {
    const publishedAd = {
      id: 'ad-123',
      organizationId: 'org-789',
      name: 'Published Ad',
      headline: 'Old Headline',
      primaryText: 'Old Text',
      description: 'Old Desc',
      callToAction: 'LEARN_MORE',
      destinationUrl: 'https://example.com',
      status: 'active',
      metaAdId: 'meta-ad-456',
      metaCreativeId: 'meta-creative-789',
      metaVideoId: 'meta-video-111',
      metaImageHash: null,
      metaCampaignId: 'campaign-222',
      metaAdsPageId: 'page-333',
      useExistingPost: false,
    };

    const publishedImageAd = {
      ...publishedAd,
      metaVideoId: null,
      metaImageHash: 'image-hash-444',
    };

    it('skips Meta sync for draft ads (no metaAdId)', async () => {
      const draftAd = { ...publishedAd, metaAdId: null };
      mockDb.query.metaAd.findFirst.mockResolvedValueOnce(draftAd);
      mockDb.returning.mockResolvedValueOnce([
        { ...draftAd, headline: 'New Headline' },
      ]);

      const result = await updateAd(mockDb as never, {
        adId: 'ad-123',
        organizationId: 'org-789',
        headline: 'New Headline',
      });

      expect(result.success).toBe(true);
      expect(mocks.mockGetMetaCredentials).not.toHaveBeenCalled();
      expect(mockUpdateAd).not.toHaveBeenCalled();
    });

    it('syncs only name to Meta when no creative fields changed', async () => {
      mockDb.query.metaAd.findFirst.mockResolvedValueOnce(publishedAd);
      mockDb.query.metaCampaignConfig.findFirst.mockResolvedValueOnce({
        adAccountId: 'act_123',
      });
      mockDb.returning.mockResolvedValueOnce([
        { ...publishedAd, name: 'New Name' },
      ]);

      const result = await updateAd(mockDb as never, {
        adId: 'ad-123',
        organizationId: 'org-789',
        name: 'New Name',
      });

      expect(result.success).toBe(true);
      expect(mockUpdateAd).toHaveBeenCalledWith('meta-ad-456', {
        name: 'New Name',
      });
      expect(mockCreateAdCreative).not.toHaveBeenCalled();
      expect(mockCreateAdCreativeFromImage).not.toHaveBeenCalled();
    });

    it('creates new video creative when headline changes on video ad', async () => {
      mockDb.query.metaAd.findFirst.mockResolvedValueOnce(publishedAd);
      mockDb.query.metaCampaignConfig.findFirst.mockResolvedValueOnce({
        adAccountId: 'act_123',
      });
      const updatedAd = { ...publishedAd, headline: 'New Headline' };
      mockDb.returning.mockResolvedValueOnce([updatedAd]);
      mocks.mockBuildAdCreative.mockResolvedValueOnce({
        success: true,
        data: { creativeId: 'new-creative-555' },
      });

      const result = await updateAd(mockDb as never, {
        adId: 'ad-123',
        organizationId: 'org-789',
        headline: 'New Headline',
      });

      expect(result.success).toBe(true);
      // Routes through the shared builder, passing the updated ad row + the
      // stored video thumbnail (so video_data gets its required image_url).
      expect(mocks.mockBuildAdCreative).toHaveBeenCalled();
      const videoArgs = mocks.mockBuildAdCreative.mock.calls[0]?.[2];
      expect(videoArgs).toMatchObject({
        adRecord: expect.objectContaining({ headline: 'New Headline' }),
        metaVideoId: 'meta-video-111',
        videoThumbnailUrl: publishedAd.metaThumbnailUrl ?? undefined,
      });
      expect(mockUpdateAd).toHaveBeenCalledWith('meta-ad-456', {
        creative: { creative_id: 'new-creative-555' },
      });
    });

    it('creates new image creative when headline changes on image ad', async () => {
      mockDb.query.metaAd.findFirst.mockResolvedValueOnce(publishedImageAd);
      mockDb.query.metaCampaignConfig.findFirst.mockResolvedValueOnce({
        adAccountId: 'act_123',
      });
      const updatedAd = { ...publishedImageAd, headline: 'New Headline' };
      mockDb.returning.mockResolvedValueOnce([updatedAd]);
      mocks.mockBuildAdCreative.mockResolvedValueOnce({
        success: true,
        data: { creativeId: 'new-creative-666' },
      });

      const result = await updateAd(mockDb as never, {
        adId: 'ad-123',
        organizationId: 'org-789',
        headline: 'New Headline',
      });

      expect(result.success).toBe(true);
      expect(mocks.mockBuildAdCreative).toHaveBeenCalled();
      const imageArgs = mocks.mockBuildAdCreative.mock.calls[0]?.[2];
      expect(imageArgs).toMatchObject({
        adRecord: expect.objectContaining({ headline: 'New Headline' }),
        metaImageHash: 'image-hash-444',
      });
      expect(mockUpdateAd).toHaveBeenCalledWith('meta-ad-456', {
        creative: { creative_id: 'new-creative-666' },
      });
    });

    it('sends both name and creative when both change', async () => {
      mockDb.query.metaAd.findFirst.mockResolvedValueOnce(publishedAd);
      mockDb.query.metaCampaignConfig.findFirst.mockResolvedValueOnce({
        adAccountId: 'act_123',
      });
      const updatedAd = {
        ...publishedAd,
        name: 'New Name',
        headline: 'New Headline',
      };
      mockDb.returning.mockResolvedValueOnce([updatedAd]);
      mocks.mockBuildAdCreative.mockResolvedValueOnce({
        success: true,
        data: { creativeId: 'new-creative-777' },
      });

      const result = await updateAd(mockDb as never, {
        adId: 'ad-123',
        organizationId: 'org-789',
        name: 'New Name',
        headline: 'New Headline',
      });

      expect(result.success).toBe(true);
      expect(mockUpdateAd).toHaveBeenCalledWith('meta-ad-456', {
        name: 'New Name',
        creative: { creative_id: 'new-creative-777' },
      });
    });

    it('skips Meta sync when only targetingOverride changes', async () => {
      mockDb.query.metaAd.findFirst.mockResolvedValueOnce(publishedAd);
      mockDb.returning.mockResolvedValueOnce([
        { ...publishedAd, targetingOverride: { ageMin: 30 } },
      ]);

      const result = await updateAd(mockDb as never, {
        adId: 'ad-123',
        organizationId: 'org-789',
        targetingOverride: { ageMin: 30 },
      });

      expect(result.success).toBe(true);
      expect(mocks.mockGetMetaCredentials).not.toHaveBeenCalled();
      expect(mockUpdateAd).not.toHaveBeenCalled();
    });

    it('returns error for useExistingPost ad with creative field changes', async () => {
      const existingPostAd = { ...publishedAd, useExistingPost: true };
      mockDb.query.metaAd.findFirst.mockResolvedValueOnce(existingPostAd);
      mockDb.returning.mockResolvedValueOnce([
        { ...existingPostAd, headline: 'New' },
      ]);

      const result = await updateAd(mockDb as never, {
        adId: 'ad-123',
        organizationId: 'org-789',
        headline: 'New',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(AdErrorCodes.INVALID_AD_STATE);
        expect(result.error.message).toContain('existing post');
      }
    });

    it('returns error for imported ad without media references', async () => {
      const importedAd = {
        ...publishedAd,
        metaVideoId: null,
        metaImageHash: null,
      };
      mockDb.query.metaAd.findFirst.mockResolvedValueOnce(importedAd);
      mockDb.returning.mockResolvedValueOnce([
        { ...importedAd, headline: 'New' },
      ]);

      const result = await updateAd(mockDb as never, {
        adId: 'ad-123',
        organizationId: 'org-789',
        headline: 'New',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(AdErrorCodes.META_SYNC_FAILED);
      }
    });

    it('sets ad error and returns failure when Meta API fails', async () => {
      mockDb.query.metaAd.findFirst.mockResolvedValueOnce(publishedAd);
      mockDb.query.metaCampaignConfig.findFirst.mockResolvedValueOnce({
        adAccountId: 'act_123',
      });
      mockDb.returning.mockResolvedValueOnce([
        { ...publishedAd, headline: 'New' },
      ]);
      // A Meta API error propagates out of the shared builder (it only returns
      // err() for local validation issues), so it hits the catch → setAdError +
      // handleMetaError, same as before the refactor.
      mocks.mockBuildAdCreative.mockRejectedValueOnce(
        new Error('Meta API error')
      );

      const result = await updateAd(mockDb as never, {
        adId: 'ad-123',
        organizationId: 'org-789',
        headline: 'New',
      });

      expect(result.success).toBe(false);
      // The real `getMetaErrorMessage` extracts the message off the thrown
      // error and it is persisted onto the ad row.
      expect(mocks.mockSetAdError).toHaveBeenCalledWith(
        expect.anything(),
        'ad-123',
        'Meta API error'
      );
      expect(mocks.mockHandleMetaError).toHaveBeenCalled();
    });
  });
});
