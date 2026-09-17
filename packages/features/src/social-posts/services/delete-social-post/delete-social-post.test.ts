import { decryptCredentials } from '@borradh-workspace/integrations';
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

// Mock fetch for Meta API calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { deleteSocialPost } from './delete-social-post.service.js';

describe('deleteSocialPost', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockFetch.mockReset();
    vi.mocked(decryptCredentials).mockReturnValue({
      accessToken: 'decrypted_token',
    });
  });

  const validInput = {
    id: 'post_123',
    organizationId: 'org_123',
  };

  const mockIntegration = {
    id: 'integration_1',
    organizationId: 'org_123',
    isActive: true,
    defaultPageId: 'page_1',
  };

  const mockPage = {
    id: 'page_1',
    metaAdsIntegrationId: 'integration_1',
    pageId: 'fb_page_id',
    pageAccessToken: 'encrypted_token',
    isActive: true,
  };

  it('should delete draft post successfully', async () => {
    const draftPost = {
      id: 'post_123',
      organizationId: 'org_123',
      status: 'draft',
      platformResults: null,
    };

    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(draftPost);

    const result = await deleteSocialPost(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
    }
    expect(mockDb.delete).toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should delete scheduled post successfully', async () => {
    const scheduledPost = {
      id: 'post_123',
      organizationId: 'org_123',
      status: 'scheduled',
      platformResults: null,
    };

    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(scheduledPost);

    const result = await deleteSocialPost(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('should delete published post successfully', async () => {
    const publishedPost = {
      id: 'post_123',
      organizationId: 'org_123',
      status: 'published',
      platformResults: null,
    };

    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(publishedPost);

    const result = await deleteSocialPost(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('should delete failed post successfully', async () => {
    const failedPost = {
      id: 'post_123',
      organizationId: 'org_123',
      status: 'failed',
      platformResults: null,
    };

    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(failedPost);

    const result = await deleteSocialPost(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('should return NOT_FOUND when post does not exist', async () => {
    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      deleteSocialPost(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toBe('Social post not found');
    });

    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('should return CONFLICT for publishing post', async () => {
    const publishingPost = {
      id: 'post_123',
      organizationId: 'org_123',
      status: 'publishing',
      platformResults: null,
    };

    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(publishingPost);

    await expectResult(
      deleteSocialPost(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.CONFLICT);
      expect(error.message).toContain('currently publishing');
    });

    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('should return NOT_FOUND for post from different organization', async () => {
    // findFirst with organization filter returns null for wrong org
    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(null);

    const result = await deleteSocialPost(mockDb as never, {
      id: 'post_123',
      organizationId: 'different_org',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    const invalidInput = { organizationId: 'org_123' };

    await expectResult(
      deleteSocialPost(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = { id: 'post_123' };

    await expectResult(
      deleteSocialPost(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  // =====================================================================
  // Meta deletion tests
  // =====================================================================

  describe('Meta deletion (best-effort)', () => {
    it('should call DELETE on Meta for published post with FB postId', async () => {
      const publishedPost = {
        id: 'post_123',
        organizationId: 'org_123',
        status: 'published',
        platformResults: [
          {
            platform: 'facebook',
            success: true,
            postId: 'fb_post_123',
            postUrl: 'https://www.facebook.com/fb_post_123',
            publishedAt: '2025-01-01T00:00:00Z',
          },
        ],
      };

      mockDb.query.socialPost.findFirst.mockResolvedValueOnce(publishedPost);
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
        mockIntegration
      );
      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(mockPage);
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const result = await deleteSocialPost(mockDb as never, validInput);

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('fb_post_123'),
        expect.objectContaining({ method: 'DELETE' })
      );
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should call DELETE on Meta for both FB and IG postIds', async () => {
      const publishedPost = {
        id: 'post_123',
        organizationId: 'org_123',
        status: 'published',
        platformResults: [
          {
            platform: 'facebook',
            success: true,
            postId: 'fb_post_123',
            postUrl: 'https://www.facebook.com/fb_post_123',
            publishedAt: '2025-01-01T00:00:00Z',
          },
          {
            platform: 'instagram',
            success: true,
            postId: 'ig_post_456',
            postUrl: 'https://www.instagram.com/p/ig_post_456',
            publishedAt: '2025-01-01T00:00:00Z',
          },
        ],
      };

      mockDb.query.socialPost.findFirst.mockResolvedValueOnce(publishedPost);
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
        mockIntegration
      );
      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(mockPage);
      mockFetch
        .mockResolvedValueOnce({ ok: true, status: 200 })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const result = await deleteSocialPost(mockDb as never, validInput);

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should still delete locally when Meta API fails', async () => {
      const publishedPost = {
        id: 'post_123',
        organizationId: 'org_123',
        status: 'published',
        platformResults: [
          {
            platform: 'facebook',
            success: true,
            postId: 'fb_post_123',
            postUrl: 'https://www.facebook.com/fb_post_123',
            publishedAt: '2025-01-01T00:00:00Z',
          },
        ],
      };

      mockDb.query.socialPost.findFirst.mockResolvedValueOnce(publishedPost);
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
        mockIntegration
      );
      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(mockPage);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () =>
          Promise.resolve({ error: { message: 'Internal Server Error' } }),
      });

      const result = await deleteSocialPost(mockDb as never, validInput);

      expect(result.success).toBe(true);
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should still delete locally when no Meta integration exists', async () => {
      const publishedPost = {
        id: 'post_123',
        organizationId: 'org_123',
        status: 'published',
        platformResults: [
          {
            platform: 'facebook',
            success: true,
            postId: 'fb_post_123',
            postUrl: 'https://www.facebook.com/fb_post_123',
            publishedAt: '2025-01-01T00:00:00Z',
          },
        ],
      };

      mockDb.query.socialPost.findFirst.mockResolvedValueOnce(publishedPost);
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);

      const result = await deleteSocialPost(mockDb as never, validInput);

      expect(result.success).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should not call fetch for draft post with no platformResults', async () => {
      const draftPost = {
        id: 'post_123',
        organizationId: 'org_123',
        status: 'draft',
        platformResults: null,
      };

      mockDb.query.socialPost.findFirst.mockResolvedValueOnce(draftPost);

      const result = await deleteSocialPost(mockDb as never, validInput);

      expect(result.success).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should not call fetch for failed publish with no postIds', async () => {
      const failedPost = {
        id: 'post_123',
        organizationId: 'org_123',
        status: 'failed',
        platformResults: [
          {
            platform: 'facebook',
            success: false,
            error: 'Publishing failed',
          },
        ],
      };

      mockDb.query.socialPost.findFirst.mockResolvedValueOnce(failedPost);

      const result = await deleteSocialPost(mockDb as never, validInput);

      expect(result.success).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should treat 404 from Meta as success (post already gone)', async () => {
      const publishedPost = {
        id: 'post_123',
        organizationId: 'org_123',
        status: 'published',
        platformResults: [
          {
            platform: 'facebook',
            success: true,
            postId: 'fb_post_123',
            postUrl: 'https://www.facebook.com/fb_post_123',
            publishedAt: '2025-01-01T00:00:00Z',
          },
        ],
      };

      mockDb.query.socialPost.findFirst.mockResolvedValueOnce(publishedPost);
      mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
        mockIntegration
      );
      mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(mockPage);
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

      const result = await deleteSocialPost(mockDb as never, validInput);

      expect(result.success).toBe(true);
      expect(mockDb.delete).toHaveBeenCalled();
    });
  });
});
