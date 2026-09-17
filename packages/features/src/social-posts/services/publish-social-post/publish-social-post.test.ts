import { decryptCredentials } from '@borradh-workspace/integrations';
import { isFeatureEnabled } from '@borradh-workspace/observability';
import {
  extractKeyFromCdnUrl,
  getCdnUrl,
  getSignedCdnUrl,
} from '@borradh-workspace/storage';
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
import * as markNeedsReconnect from '../../../integrations/services/mark-needs-reconnect/mark-needs-reconnect.service.js';
import { ErrorCodes } from '../../../shared/index.js';

// `mark-needs-reconnect` is an INTERNAL module shared with its own test (and
// handle-meta-error.test.ts) which exercise the REAL `handleMetaAuthError` — a
// file-local `vi.mock` would leak under `isolate: false`, so use a restored
// `vi.spyOn` (created in beforeEach, restored in afterEach).
let mockHandleMetaAuthError: ReturnType<typeof vi.spyOn>;

// `@borradh-workspace/storage` is a canonically aliased mock (vite.config.ts) —
// no file-local `vi.mock` (it would leak under `isolate: false`). The canonical
// defaults (`isCdnEnabled` → false, `parseS3Url` → null) give the behaviour this
// suite needs; storage URL values aren't asserted here.

// Mock fetch for Meta API calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { publishSocialPost } from './publish-social-post.service.js';

describe('publishSocialPost', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockFetch.mockReset();
    mockHandleMetaAuthError = vi
      .spyOn(markNeedsReconnect, 'handleMetaAuthError')
      .mockResolvedValue(undefined as never);
    vi.mocked(decryptCredentials).mockReturnValue({
      accessToken: 'mock_page_access_token',
    });
  });

  afterEach(() => {
    mockHandleMetaAuthError.mockRestore();
  });

  const validInput = {
    id: 'post_123',
    organizationId: 'org_123',
  };

  const mockPage = {
    id: 'page_123',
    metaAdsIntegrationId: 'int_123',
    pageId: 'fb_page_123',
    pageAccessToken: 'encrypted_token',
    isActive: true,
  };

  it('should publish image post to Facebook successfully', async () => {
    const draftPost = {
      id: 'post_123',
      organizationId: 'org_123',
      title: 'Test Post',
      caption: 'Test caption',
      mediaType: 'image',
      mediaUrl: 'https://example.com/image.jpg',
      platforms: ['facebook'],
      status: 'draft',
    };

    const integration = {
      id: 'int_123',
      organizationId: 'org_123',
      pageId: 'page_123',
      pageAccessToken: 'encrypted_token',
      isActive: true,
    };

    const publishedPost = {
      ...draftPost,
      status: 'published',
      publishedAt: new Date(),
      platformResults: [
        {
          platform: 'facebook',
          success: true,
          postId: 'fb_post_123',
          postUrl: 'https://www.facebook.com/fb_post_123',
        },
      ],
    };

    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(draftPost);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      integration
    );
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(mockPage);
    mockDb.returning.mockResolvedValueOnce([publishedPost]);

    // Mock Facebook API response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ id: 'fb_post_123', post_id: 'fb_post_123' }),
    });

    const result = await publishSocialPost(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('published');
      expect(result.data.platformResults).toHaveLength(1);
    }
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should publish video post to Facebook successfully', async () => {
    const videoPost = {
      id: 'post_123',
      organizationId: 'org_123',
      mediaType: 'video',
      mediaUrl: 'https://example.com/video.mp4',
      caption: 'Video caption',
      platforms: ['facebook'],
      status: 'scheduled',
    };

    const integration = {
      id: 'int_123',
      organizationId: 'org_123',
      pageId: 'page_123',
      pageAccessToken: 'encrypted_token',
      isActive: true,
    };

    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(videoPost);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      integration
    );
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(mockPage);
    mockDb.returning.mockResolvedValueOnce([
      { ...videoPost, status: 'published' },
    ]);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'fb_video_123' }),
    });

    const result = await publishSocialPost(mockDb as never, validInput);

    expect(result.success).toBe(true);
  });

  it('should publish to multiple platforms', async () => {
    const multiPlatformPost = {
      id: 'post_123',
      organizationId: 'org_123',
      mediaType: 'image',
      mediaUrl: 'https://example.com/image.jpg',
      caption: 'Multi-platform post',
      platforms: ['facebook', 'instagram'],
      status: 'draft',
    };

    const integration = {
      id: 'int_123',
      organizationId: 'org_123',
      pageId: 'page_123',
      pageAccessToken: 'encrypted_token',
      isActive: true,
    };

    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(multiPlatformPost);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      integration
    );
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(mockPage);
    mockDb.returning.mockResolvedValueOnce([
      { ...multiPlatformPost, status: 'published' },
    ]);

    // Facebook photo post
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'fb_post_123' }),
    });

    // Get Instagram account
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ instagram_business_account: { id: 'ig_123' } }),
    });

    // Instagram container creation
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'container_123' }),
    });

    // Instagram publish
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'ig_post_123' }),
    });

    const result = await publishSocialPost(mockDb as never, validInput);

    expect(result.success).toBe(true);
  });

  it('flag ON: publishes Instagram via the page-linked account on graph.facebook.com', async () => {
    // Kill-switch ON for this org → prefer the page-linked IG account on the
    // durable system-user (page) token, hitting graph.facebook.com, using the
    // stored linked IG id directly (no instagram_business_account lookup).
    vi.mocked(isFeatureEnabled).mockReturnValueOnce(true as never);

    const igPost = {
      id: 'post_123',
      organizationId: 'org_123',
      mediaType: 'image',
      mediaUrl: 'https://example.com/image.jpg',
      caption: 'IG only',
      platforms: ['instagram'],
      status: 'draft',
    };

    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(igPost);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'int_123',
      organizationId: 'org_123',
      isActive: true,
    });
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
      ...mockPage,
      linkedInstagramAccountId: 'ig_direct_123',
    });
    mockDb.returning.mockResolvedValueOnce([
      { ...igPost, status: 'published' },
    ]);

    // Container creation → status poll (FINISHED) → publish.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'container_123' }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status_code: 'FINISHED' }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'ig_post_123' }),
    });

    const result = await publishSocialPost(mockDb as never, validInput);

    expect(result.success).toBe(true);
    const containerUrl = mockFetch.mock.calls[0][0] as string;
    expect(containerUrl).toContain('graph.facebook.com');
    expect(containerUrl).toContain('ig_direct_123/media');
    expect(containerUrl).not.toContain('graph.instagram.com');
  });

  it('re-signs an already-signed (expired) CDN media URL before publishing', async () => {
    // Graphic outputs are stored as short-lived signed CloudFront URLs; by
    // publish time the signature is expired. The publish path must re-sign it,
    // not pass the dead URL to Meta (which caused FB 324 / IG 9004 fetch fails).
    const key = 'org_123/graphics/abc/0.png';
    const expiredCdnUrl = `https://cdn.borradh.io/${key}?Expires=1782150042&Signature=dead`;
    const freshSignedUrl = `https://cdn.borradh.io/${key}?Expires=9999999999&Signature=fresh`;

    // `mockReturnValueOnce` so these don't leak under `isolate: false`.
    vi.mocked(getCdnUrl).mockReturnValueOnce('https://cdn.borradh.io');
    vi.mocked(extractKeyFromCdnUrl).mockReturnValueOnce(key);
    vi.mocked(getSignedCdnUrl).mockReturnValueOnce(freshSignedUrl);

    const post = {
      id: 'post_123',
      organizationId: 'org_123',
      mediaType: 'image',
      mediaUrl: expiredCdnUrl,
      caption: 'x',
      platforms: ['facebook'],
      status: 'scheduled',
    };

    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(post);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'int_123',
      organizationId: 'org_123',
      isActive: true,
    });
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(mockPage);
    mockDb.returning.mockResolvedValueOnce([{ ...post, status: 'published' }]);

    // Facebook photo post
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'fb_post_123' }),
    });

    const result = await publishSocialPost(mockDb as never, validInput);

    expect(result.success).toBe(true);
    // Re-signed despite the URL already carrying a query string.
    expect(getSignedCdnUrl).toHaveBeenCalledWith(key, 3600);
    // The fresh URL — not the expired one — was sent to Facebook.
    const fbCall = mockFetch.mock.calls.find(([u]) =>
      String(u).includes('/photos')
    );
    expect(fbCall).toBeTruthy();
    expect(String(fbCall?.[1]?.body)).toContain('Signature%3Dfresh');
    expect(String(fbCall?.[1]?.body)).not.toContain('Signature%3Ddead');
  });

  it('publishes a multi-image carousel to Facebook and Instagram', async () => {
    // The regression this guards: a carousel graphic (multiple slides) must
    // post ALL slides — Facebook as a multi-photo feed post, Instagram as a
    // CAROUSEL container — not just the first image.
    const carouselPost = {
      id: 'post_123',
      organizationId: 'org_123',
      mediaType: 'image',
      mediaUrl: 'https://example.com/slide-0.jpg',
      mediaUrls: [
        'https://example.com/slide-0.jpg',
        'https://example.com/slide-1.jpg',
        'https://example.com/slide-2.jpg',
      ],
      caption: 'Carousel caption',
      platforms: ['facebook', 'instagram'],
      status: 'draft',
    };

    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(carouselPost);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'int_123',
      organizationId: 'org_123',
      isActive: true,
    });
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(mockPage);
    mockDb.returning.mockResolvedValueOnce([
      { ...carouselPost, status: 'published' },
    ]);

    // Route Meta API calls by URL/body so we don't depend on exact call order.
    const resp = (json: unknown) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(json) });
    let photoCount = 0;
    let childCount = 0;
    mockFetch.mockImplementation((url: string, opts?: { body?: string }) => {
      const u = String(url);
      const body = String(opts?.body ?? '');
      if (u.includes('status_code')) return resp({ status_code: 'FINISHED' });
      if (u.includes('/photos')) return resp({ id: `ph_${++photoCount}` });
      if (u.includes('/feed'))
        return resp({ id: 'fb_post_123', post_id: 'fb_post_123' });
      if (u.includes('instagram_business_account'))
        return resp({ instagram_business_account: { id: 'ig_123' } });
      if (u.includes('/media_publish')) return resp({ id: 'ig_post_123' });
      if (u.includes('/media'))
        return resp({
          id: body.includes('CAROUSEL')
            ? 'carousel_1'
            : `child_${++childCount}`,
        });
      return resp({});
    });

    const result = await publishSocialPost(mockDb as never, validInput);

    expect(result.success).toBe(true);

    // Facebook: 3 unpublished photo uploads, then one feed post attaching all 3.
    const photoCalls = mockFetch.mock.calls.filter(([u]) =>
      String(u).includes('/photos')
    );
    expect(photoCalls).toHaveLength(3);
    const feedCall = mockFetch.mock.calls.find(([u]) =>
      String(u).includes('/feed')
    );
    expect(feedCall).toBeTruthy();
    const feedBody = String(feedCall?.[1]?.body);
    expect(feedBody).toContain('attached_media%5B0%5D');
    expect(feedBody).toContain('attached_media%5B2%5D');

    // Instagram: 3 carousel-item children, then a CAROUSEL parent container.
    const childCalls = mockFetch.mock.calls.filter(([u, o]) => {
      const b = String((o as { body?: string })?.body ?? '');
      return String(u).includes('/media') && b.includes('is_carousel_item');
    });
    expect(childCalls).toHaveLength(3);
    const carouselCall = mockFetch.mock.calls.find(([u, o]) => {
      const b = String((o as { body?: string })?.body ?? '');
      return String(u).includes('/media') && b.includes('CAROUSEL');
    });
    expect(carouselCall).toBeTruthy();
    expect(String(carouselCall?.[1]?.body)).toContain('children=');
  });

  it('falls back to a linked carousel graphic when mediaUrls is absent', async () => {
    // Posts created before media_urls existed only carry a single mediaUrl, but
    // still link the source graphic. The publisher must expand a carousel
    // graphic's slides so already-scheduled carousels post all images.
    const legacyPost = {
      id: 'post_123',
      organizationId: 'org_123',
      mediaType: 'image',
      mediaUrl: 'https://example.com/slide-0.jpg',
      mediaUrls: null,
      graphicId: 'graphic_123',
      caption: 'Legacy carousel',
      platforms: ['facebook'],
      status: 'scheduled',
    };

    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(legacyPost);
    mockDb.query.graphic.findFirst.mockResolvedValueOnce({
      id: 'graphic_123',
      kind: 'carousel',
      outputs: [
        { url: 'https://example.com/slide-0.jpg', slideOrder: 0 },
        { url: 'https://example.com/slide-1.jpg', slideOrder: 1 },
      ],
    });
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'int_123',
      organizationId: 'org_123',
      isActive: true,
    });
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(mockPage);
    mockDb.returning.mockResolvedValueOnce([
      { ...legacyPost, status: 'published' },
    ]);

    const resp = (json: unknown) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(json) });
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/photos')) return resp({ id: 'ph_x' });
      if (u.includes('/feed'))
        return resp({ id: 'fb_post_123', post_id: 'fb_post_123' });
      return resp({});
    });

    const result = await publishSocialPost(mockDb as never, validInput);

    expect(result.success).toBe(true);
    // Two slides resolved from the graphic → two photo uploads + one feed post.
    const photoCalls = mockFetch.mock.calls.filter(([u]) =>
      String(u).includes('/photos')
    );
    expect(photoCalls).toHaveLength(2);
    expect(
      mockFetch.mock.calls.some(([u]) => String(u).includes('/feed'))
    ).toBe(true);
  });

  it('should handle partial success with multiple platforms', async () => {
    const multiPlatformPost = {
      id: 'post_123',
      organizationId: 'org_123',
      mediaType: 'image',
      mediaUrl: 'https://example.com/image.jpg',
      platforms: ['facebook', 'instagram'],
      status: 'draft',
    };

    const integration = {
      id: 'int_123',
      organizationId: 'org_123',
      pageId: 'page_123',
      pageAccessToken: 'encrypted_token',
      isActive: true,
    };

    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(multiPlatformPost);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      integration
    );
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(mockPage);
    mockDb.returning.mockResolvedValueOnce([
      { ...multiPlatformPost, status: 'partial' },
    ]);

    // Facebook success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'fb_post_123' }),
    });

    // Instagram account not connected
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}), // No instagram_business_account
    });

    const result = await publishSocialPost(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('partial');
    }
  });

  it('should return NOT_FOUND when post does not exist', async () => {
    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      publishSocialPost(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toBe('Social post not found');
    });
  });

  it('should return CONFLICT for already published post', async () => {
    const publishedPost = {
      id: 'post_123',
      organizationId: 'org_123',
      status: 'published',
    };

    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(publishedPost);

    await expectResult(
      publishSocialPost(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.CONFLICT);
      expect(error.message).toContain('already been published');
    });
  });

  it('should return CONFLICT for currently publishing post', async () => {
    const publishingPost = {
      id: 'post_123',
      organizationId: 'org_123',
      status: 'publishing',
    };

    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(publishingPost);

    await expectResult(
      publishSocialPost(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.CONFLICT);
      expect(error.message).toContain('currently being published');
    });
  });

  it('should return FORBIDDEN when Meta integration not found', async () => {
    const draftPost = {
      id: 'post_123',
      organizationId: 'org_123',
      platforms: ['facebook'],
      status: 'draft',
    };

    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(draftPost);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      publishSocialPost(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.FORBIDDEN);
      expect(error.message).toContain('Meta integration');
    });
  });

  it('should return FORBIDDEN when Meta integration not active', async () => {
    const draftPost = {
      id: 'post_123',
      organizationId: 'org_123',
      platforms: ['facebook'],
      status: 'draft',
    };

    const inactiveIntegration = {
      id: 'int_123',
      organizationId: 'org_123',
      isActive: false,
    };

    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(draftPost);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      inactiveIntegration
    );

    await expectResult(
      publishSocialPost(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.FORBIDDEN);
      expect(error.message).toContain('No Facebook Page connected');
    });
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    const invalidInput = { organizationId: 'org_123' };

    await expectResult(
      publishSocialPost(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = { id: 'post_123' };

    await expectResult(
      publishSocialPost(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
