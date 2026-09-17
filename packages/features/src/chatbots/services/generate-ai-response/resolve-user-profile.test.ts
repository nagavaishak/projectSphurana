import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { mockMetaMessagingService } from '@borradh-workspace/integrations/meta-messaging';
import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ResolveUserProfileInput,
  resolveUserProfile,
} from './resolve-user-profile.js';

const mockGetUserProfile = vi.mocked(mockMetaMessagingService.getUserProfile);

describe('resolveUserProfile', () => {
  const mockDb = createMockDatabase();

  const makeInput = (
    overrides: Partial<ResolveUserProfileInput> = {}
  ): ResolveUserProfileInput => ({
    conversationId: 'conv-1',
    externalUserId: 'ext-user-1',
    platform: 'facebook_messenger',
    metaAdsPageId: 'page-1',
    existingSenderName: null,
    rawMetadata: null,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    vi.mocked(decryptCredentials).mockReturnValue({
      accessToken: 'test-token',
    });
  });

  it('should return existing metadata name when available', async () => {
    const result = await resolveUserProfile(
      mockDb as never,
      makeInput({
        rawMetadata: { name: 'Sarah' },
      })
    );

    expect(result.displayName).toBe('Sarah');
    expect(mockGetUserProfile).not.toHaveBeenCalled();
  });

  it('should return existingSenderName when metadata name is missing', async () => {
    const result = await resolveUserProfile(
      mockDb as never,
      makeInput({
        existingSenderName: 'John',
      })
    );

    expect(result.displayName).toBe('John');
    expect(mockGetUserProfile).not.toHaveBeenCalled();
  });

  it('should fetch from Meta API when no existing name', async () => {
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
      id: 'page-1',
      pageAccessToken: 'encrypted',
      pageId: 'fb-page-1',
    });
    mockGetUserProfile.mockResolvedValueOnce({
      first_name: 'Mary',
      firstName: 'Mary',
      name: 'Mary Smith',
    });
    mockDb.where.mockResolvedValueOnce(undefined);

    const result = await resolveUserProfile(mockDb as never, makeInput());

    expect(result.displayName).toBe('Mary');
    expect(mockGetUserProfile).toHaveBeenCalled();
  });

  it('should fall back to "there" when Meta API fails', async () => {
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
      id: 'page-1',
      pageAccessToken: 'encrypted',
      pageId: 'fb-page-1',
    });
    mockGetUserProfile.mockRejectedValueOnce(new Error('API error'));

    const result = await resolveUserProfile(mockDb as never, makeInput());

    expect(result.displayName).toBe('there');
  });

  it('should not call API when pageAccessToken is missing', async () => {
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
      id: 'page-1',
      pageAccessToken: null,
      pageId: 'fb-page-1',
    });

    const result = await resolveUserProfile(mockDb as never, makeInput());

    expect(result.displayName).toBe('there');
    expect(mockGetUserProfile).not.toHaveBeenCalled();
  });

  it('should not call API when metaAdsPageId is null', async () => {
    const result = await resolveUserProfile(
      mockDb as never,
      makeInput({
        metaAdsPageId: null,
      })
    );

    expect(result.displayName).toBe('there');
    expect(mockGetUserProfile).not.toHaveBeenCalled();
  });

  it('should not call API for non-Meta platforms', async () => {
    const result = await resolveUserProfile(
      mockDb as never,
      makeInput({
        platform: 'whatsapp',
      })
    );

    expect(result.displayName).toBe('there');
    expect(mockGetUserProfile).not.toHaveBeenCalled();
  });

  it('should persist resolved name to conversation when fetched', async () => {
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
      id: 'page-1',
      pageAccessToken: 'encrypted',
      pageId: 'fb-page-1',
    });
    mockGetUserProfile.mockResolvedValueOnce({
      first_name: 'Jane',
      firstName: 'Jane',
      name: 'Jane Doe',
    });
    mockDb.where.mockResolvedValueOnce(undefined);

    const result = await resolveUserProfile(mockDb as never, makeInput());

    expect(result.displayName).toBe('Jane');
    expect(result.updatedMetadata?.name).toBe('Jane');
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        externalUserName: 'Jane',
      })
    );
  });

  it('should handle Instagram DM platform', async () => {
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
      id: 'page-1',
      pageAccessToken: 'encrypted',
      pageId: 'fb-page-1',
    });
    mockGetUserProfile.mockResolvedValueOnce({
      name: 'ig_user',
    });
    mockDb.where.mockResolvedValueOnce(undefined);

    const result = await resolveUserProfile(
      mockDb as never,
      makeInput({
        platform: 'instagram_dm',
      })
    );

    expect(result.displayName).toBe('ig_user');
  });
});
