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

const mocks = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

// Mock global fetch at module level (before service import)
vi.stubGlobal('fetch', mocks.mockFetch);

import { getPostEngagement } from './get-post-engagement.service.js';

describe('getPostEngagement', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    socialPostId: 'post_123',
    organizationId: 'org_123',
  };

  it('should return Instagram engagement', async () => {
    mockDb.query.socialPost.findFirst.mockResolvedValueOnce({
      id: 'post_123',
      organizationId: 'org_123',
      platformResults: [
        { platform: 'instagram', success: true, postId: 'ig_post_1' },
      ],
    });
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce({
      isActive: true,
      encryptedCredentials: 'encrypted',
    });
    vi.mocked(decryptCredentials).mockReturnValueOnce({
      accessToken: 'ig_token',
    });
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ like_count: 25, comments_count: 5 }),
    });

    const result = await getPostEngagement(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.likes).toBe(25);
      expect(result.data.comments).toBe(5);
      expect(result.data.shares).toBe(0);
      expect(result.data.platform).toBe('instagram');
    }
  });

  it('should return Facebook engagement', async () => {
    mockDb.query.socialPost.findFirst.mockResolvedValueOnce({
      id: 'post_123',
      organizationId: 'org_123',
      platformResults: [
        { platform: 'facebook', success: true, postId: 'fb_post_1' },
      ],
    });
    // No Instagram integration
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'int_1',
      isActive: true,
      defaultPageId: 'page_1',
    });
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
      id: 'page_1',
      pageAccessToken: 'encrypted_page_token',
    });
    vi.mocked(decryptCredentials).mockReturnValueOnce({
      accessToken: 'page_token',
    });
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          likes: { summary: { total_count: 10 } },
          comments: { summary: { total_count: 3 } },
          shares: { count: 2 },
        }),
    });

    const result = await getPostEngagement(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.likes).toBe(10);
      expect(result.data.comments).toBe(3);
      expect(result.data.shares).toBe(2);
      expect(result.data.platform).toBe('facebook');
    }
  });

  it('should return NOT_FOUND when post does not exist', async () => {
    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getPostEngagement(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return NOT_FOUND when no published platform result', async () => {
    mockDb.query.socialPost.findFirst.mockResolvedValueOnce({
      id: 'post_123',
      organizationId: 'org_123',
      platformResults: [{ platform: 'facebook', success: false }],
    });

    await expectResult(
      getPostEngagement(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return FORBIDDEN when no Instagram integration', async () => {
    mockDb.query.socialPost.findFirst.mockResolvedValueOnce({
      id: 'post_123',
      organizationId: 'org_123',
      platformResults: [
        { platform: 'instagram', success: true, postId: 'ig_post_1' },
      ],
    });
    // No Instagram integration
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce(null);
    // No Meta Ads integration either
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      getPostEngagement(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.FORBIDDEN);
  });

  it('should return INTERNAL_ERROR when API call fails', async () => {
    mockDb.query.socialPost.findFirst.mockResolvedValueOnce({
      id: 'post_123',
      organizationId: 'org_123',
      platformResults: [
        { platform: 'instagram', success: true, postId: 'ig_post_1' },
      ],
    });
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce({
      isActive: true,
      encryptedCredentials: 'encrypted',
    });
    vi.mocked(decryptCredentials).mockReturnValueOnce({
      accessToken: 'ig_token',
    });
    mocks.mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Bad request'),
    });

    await expectResult(
      getPostEngagement(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });

  it('should return VALIDATION_ERROR for missing socialPostId', async () => {
    await expectResult(
      getPostEngagement(mockDb as never, {
        ...validInput,
        socialPostId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      getPostEngagement(mockDb as never, {
        ...validInput,
        organizationId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
