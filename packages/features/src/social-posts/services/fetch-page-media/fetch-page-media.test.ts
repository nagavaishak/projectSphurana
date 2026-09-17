import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
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

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { fetchPageMedia } from './fetch-page-media.service.js';

/** Build a fetch Response-ish object. */
function jsonRes(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

describe('fetchPageMedia', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockFetch.mockReset();
    // One credential blob satisfies both the page-token ({accessToken}) and
    // the standalone-IG ({accessToken, instagramUserId}) decrypts.
    vi.mocked(decryptCredentials).mockReturnValue({
      accessToken: 'tok',
      instagramUserId: 'ig_user_1',
    });
  });

  const validInput = { organizationId: 'org_123' };

  const activeIntegration = {
    id: 'integration_1',
    organizationId: 'org_123',
    isActive: true,
    defaultPageId: 'page_1',
  };
  const fbPage = {
    id: 'page_1',
    metaAdsIntegrationId: 'integration_1',
    pageId: 'fb_page_id',
    pageName: 'Test Page',
    pageAccessToken: 'enc',
    isActive: true,
    linkedInstagramAccountId: null,
  };

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      fetchPageMedia(mockDb as never, {} as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns FORBIDDEN when no FB page and no IG account', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      fetchPageMedia(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.FORBIDDEN);
  });

  it('pulls Facebook posts, tagging image vs video, image-only stills required', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      activeIntegration
    );
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(fbPage);
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce(null);

    // 1) FB posts page (no paging.next → single page)
    mockFetch.mockResolvedValueOnce(
      jsonRes({
        data: [
          {
            id: 'fb_1',
            message: 'A photo post',
            full_picture: 'https://cdn/fb1.jpg',
            permalink_url: 'https://fb/1',
            created_time: '2026-01-01T00:00:00Z',
            attachments: { data: [{ media_type: 'photo' }] },
          },
          {
            id: 'fb_2',
            message: 'A video post',
            full_picture: 'https://cdn/fb2.jpg',
            permalink_url: 'https://fb/2',
            created_time: '2026-01-02T00:00:00Z',
            attachments: { data: [{ media_type: 'video' }] },
          },
          {
            id: 'fb_3',
            message: 'No image — skipped',
            permalink_url: 'https://fb/3',
          },
        ],
      })
    );
    // 2) linked-IG lookup (page has no linkedInstagramAccountId) → none
    mockFetch.mockResolvedValueOnce(jsonRes({}));

    const result = await fetchPageMedia(mockDb as never, validInput);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.items).toHaveLength(2);
    const [p1, p2] = result.data.items;
    expect(p1).toMatchObject({
      id: 'fb_1',
      platform: 'facebook',
      mediaType: 'image',
      mediaUrl: 'https://cdn/fb1.jpg',
      thumbnailUrl: 'https://cdn/fb1.jpg',
    });
    expect(p2).toMatchObject({ id: 'fb_2', mediaType: 'video' });
    expect(result.data.sources.facebook).toEqual({
      connected: true,
      count: 2,
    });
    expect(result.data.sources.instagram.count).toBe(0);
  });

  it('pulls Instagram media from a standalone integration', async () => {
    // No FB integration; standalone IG present.
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(null);
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce({
      id: 'ig_int_1',
      organizationId: 'org_123',
      isActive: true,
      encryptedCredentials: 'enc',
    });

    mockFetch.mockResolvedValueOnce(
      jsonRes({
        data: [
          {
            id: 'ig_1',
            caption: 'IG image',
            media_type: 'IMAGE',
            media_url: 'https://cdn/ig1.jpg',
            permalink: 'https://ig/1',
            timestamp: '2026-02-01T00:00:00Z',
          },
          {
            id: 'ig_2',
            caption: 'IG video',
            media_type: 'VIDEO',
            media_url: 'https://cdn/ig2.mp4',
            thumbnail_url: 'https://cdn/ig2-thumb.jpg',
            permalink: 'https://ig/2',
            timestamp: '2026-02-02T00:00:00Z',
          },
        ],
      })
    );

    const result = await fetchPageMedia(mockDb as never, validInput);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.items).toHaveLength(2);
    const img = result.data.items.find((i) => i.id === 'ig_1');
    const vid = result.data.items.find((i) => i.id === 'ig_2');
    expect(img).toMatchObject({
      platform: 'instagram',
      mediaType: 'image',
      mediaUrl: 'https://cdn/ig1.jpg',
      thumbnailUrl: 'https://cdn/ig1.jpg',
    });
    expect(vid).toMatchObject({
      mediaType: 'video',
      mediaUrl: 'https://cdn/ig2.mp4',
      thumbnailUrl: 'https://cdn/ig2-thumb.jpg',
    });
    expect(result.data.sources.instagram.connected).toBe(true);
  });

  it('is resilient: a Facebook failure still returns Instagram results', async () => {
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      activeIntegration
    );
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(fbPage);
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce({
      id: 'ig_int_1',
      organizationId: 'org_123',
      isActive: true,
      encryptedCredentials: 'enc',
    });

    // 1) FB posts → 500 error (pullFacebook throws, caught)
    mockFetch.mockResolvedValueOnce(jsonRes({ error: 'boom' }, false, 500));
    // 2) IG standalone media → ok
    mockFetch.mockResolvedValueOnce(
      jsonRes({
        data: [
          {
            id: 'ig_1',
            caption: 'IG image',
            media_type: 'IMAGE',
            media_url: 'https://cdn/ig1.jpg',
            permalink: 'https://ig/1',
            timestamp: '2026-02-01T00:00:00Z',
          },
        ],
      })
    );

    const result = await fetchPageMedia(mockDb as never, validInput);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.sources.facebook.count).toBe(0);
    expect(result.data.items).toHaveLength(1);
    expect(result.data.items[0].platform).toBe('instagram');
  });
});
