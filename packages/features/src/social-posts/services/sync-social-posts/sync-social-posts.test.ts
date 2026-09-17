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

import { syncSocialPosts } from './sync-social-posts.service.js';

describe('syncSocialPosts', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockFetch.mockReset();
    vi.mocked(decryptCredentials).mockReturnValue({
      accessToken: 'decrypted_token',
    });
  });

  const validInput = { organizationId: 'org_123' };

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

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      syncSocialPosts(mockDb as never, {} as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return FORBIDDEN when no Meta integration', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      syncSocialPosts(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.FORBIDDEN);
  });

  it('should return FORBIDDEN when integration is inactive', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      ...mockIntegration,
      isActive: false,
    });

    await expectResult(
      syncSocialPosts(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.FORBIDDEN);
  });

  it('should return ok with zero counts when no published posts', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(mockPage);
    mockDb.query.socialPost.findMany.mockResolvedValueOnce([]);

    const result = await syncSocialPosts(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ checked: 0, deleted: 0, errors: 0 });
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should skip posts without platformResults', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(mockPage);
    mockDb.query.socialPost.findMany.mockResolvedValueOnce([
      {
        id: 'post_1',
        organizationId: 'org_123',
        status: 'published',
        platformResults: null,
      },
    ]);

    const result = await syncSocialPosts(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.checked).toBe(0);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should not delete post that still exists on Meta', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(mockPage);
    mockDb.query.socialPost.findMany.mockResolvedValueOnce([
      {
        id: 'post_1',
        organizationId: 'org_123',
        status: 'published',
        platformResults: [
          {
            platform: 'facebook',
            success: true,
            postId: 'fb_post_1',
          },
        ],
      },
    ]);

    // Post still exists on Meta
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'fb_post_1' }),
    });

    const result = await syncSocialPosts(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ checked: 1, deleted: 0, errors: 0 });
    }
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('should delete post when all platform posts gone on Meta (404)', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(mockPage);
    mockDb.query.socialPost.findMany.mockResolvedValueOnce([
      {
        id: 'post_1',
        organizationId: 'org_123',
        status: 'published',
        platformResults: [
          {
            platform: 'facebook',
            success: true,
            postId: 'fb_post_1',
          },
        ],
      },
    ]);

    // Post is gone (404)
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const result = await syncSocialPosts(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ checked: 1, deleted: 1, errors: 0 });
    }
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('should delete post when Meta returns GraphMethodException (code 100)', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(mockPage);
    mockDb.query.socialPost.findMany.mockResolvedValueOnce([
      {
        id: 'post_1',
        organizationId: 'org_123',
        status: 'published',
        platformResults: [
          {
            platform: 'facebook',
            success: true,
            postId: 'fb_post_1',
          },
        ],
      },
    ]);

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          error: { code: 100, message: 'Unsupported get request' },
        }),
    });

    const result = await syncSocialPosts(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deleted).toBe(1);
    }
  });

  it('should update to partial when only some platform posts are deleted', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(mockPage);
    mockDb.query.socialPost.findMany.mockResolvedValueOnce([
      {
        id: 'post_1',
        organizationId: 'org_123',
        status: 'published',
        platformResults: [
          { platform: 'facebook', success: true, postId: 'fb_post_1' },
          { platform: 'instagram', success: true, postId: 'ig_post_1' },
        ],
      },
    ]);

    // FB still exists, IG gone
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'fb_post_1' }),
      })
      .mockResolvedValueOnce({ ok: false, status: 404 });

    const result = await syncSocialPosts(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ checked: 1, deleted: 0, errors: 0 });
    }
    // Should update, not delete
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'partial' })
    );
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('should handle multiple posts in a single sync', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      mockIntegration
    );
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(mockPage);
    mockDb.query.socialPost.findMany.mockResolvedValueOnce([
      {
        id: 'post_1',
        organizationId: 'org_123',
        status: 'published',
        platformResults: [
          { platform: 'facebook', success: true, postId: 'fb_post_1' },
        ],
      },
      {
        id: 'post_2',
        organizationId: 'org_123',
        status: 'published',
        platformResults: [
          { platform: 'facebook', success: true, postId: 'fb_post_2' },
        ],
      },
    ]);

    // post_1 exists, post_2 gone
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'fb_post_1' }),
      })
      .mockResolvedValueOnce({ ok: false, status: 404 });

    const result = await syncSocialPosts(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ checked: 2, deleted: 1, errors: 0 });
    }
  });
});
