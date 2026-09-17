import { decryptCredentials } from '@borradh-workspace/integrations';
import {
  captureAllRequests,
  expectMatchesContract,
} from '@borradh-workspace/integrations/meta-contract';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';

/**
 * REQUEST-CONTRACT TESTS — page + Instagram publishing.
 *
 * The publish paths build `application/x-www-form-urlencoded` bodies rather
 * than JSON, and they carry the media URL that upstream code resolved (CDN
 * re-signed vs S3 presigned). A wrong or mangled URL here is the classic
 * publish-time failure: FB code 324 / IG code 9004, hours after the change.
 *
 * These assert the payload against the SAME registry the contract fake
 * enforces, so all three tiers agree on what a publish looks like.
 *
 * NOTE ON MOCKS: `@borradh-workspace/storage` is a canonically aliased mock
 * (vite.config.ts) and `mark-needs-reconnect` is exercised for real elsewhere —
 * this suite adds no file-local `vi.mock` of an internal module, which would
 * leak under `isolate: false`.
 */

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { publishSocialPost } from './publish-social-post.service.js';

const INPUT = { id: 'post_123', organizationId: 'org_123' };

const PAGE = {
  id: 'page_123',
  metaAdsIntegrationId: 'int_123',
  pageId: 'fb_page_123',
  pageAccessToken: 'encrypted_token',
  isActive: true,
};

const INTEGRATION = {
  id: 'int_123',
  organizationId: 'org_123',
  pageId: 'page_123',
  pageAccessToken: 'encrypted_token',
  isActive: true,
};

/** A CDN URL carrying a signature — must reach Meta byte-for-byte. */
const CDN_MEDIA = 'https://cdn.borradh.io/img.jpg?Signature=abc&Key-Pair-Id=K1';

describe('publish contracts — Facebook page', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockFetch.mockReset();
    vi.mocked(decryptCredentials).mockReturnValue({
      accessToken: 'page_token',
    });
  });

  function seedPost(overrides: Record<string, unknown>) {
    const post = {
      id: 'post_123',
      organizationId: 'org_123',
      title: 'Test',
      caption: 'Test caption',
      platforms: ['facebook'],
      status: 'draft',
      ...overrides,
    };
    mockDb.query.socialPost.findFirst.mockResolvedValueOnce(post);
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce(
      INTEGRATION
    );
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(PAGE);
    mockDb.returning.mockResolvedValueOnce([{ ...post, status: 'published' }]);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'fb_1', post_id: 'fb_1' }),
    });
  }

  it('an image post satisfies the photos contract and preserves the signed URL', async () => {
    seedPost({ mediaType: 'image', mediaUrl: CDN_MEDIA });

    await publishSocialPost(mockDb as never, INPUT);

    const requests = captureAllRequests(mockFetch);
    const photo = requests.find((r) => r.endpointId === 'pages.publishPhoto');
    expect(photo, 'no photos request was made').toBeDefined();

    const payload = expectMatchesContract(
      photo as NonNullable<typeof photo>,
      'pages.publishPhoto'
    );

    // Byte-for-byte: re-encoding a signed URL invalidates the signature and
    // Meta fails to fetch the media (FB code 324).
    expect(payload.url).toBe(CDN_MEDIA);
    expect(payload.message).toBe('Test caption');
    expect(payload.access_token).toBe('page_token');
  });

  it('a video post satisfies the videos contract', async () => {
    seedPost({
      mediaType: 'video',
      mediaUrl: 'https://cdn.borradh.io/clip.mp4?Signature=xyz',
    });

    await publishSocialPost(mockDb as never, INPUT);

    const video = captureAllRequests(mockFetch).find(
      (r) => r.endpointId === 'pages.publishVideo'
    );
    expect(video, 'no videos request was made').toBeDefined();

    const payload = expectMatchesContract(
      video as NonNullable<typeof video>,
      'pages.publishVideo'
    );

    // Videos use `file_url` + `description`, NOT `url` + `message`. Mixing the
    // two is accepted with a 200 and silently publishes nothing usable.
    expect(payload.file_url).toBe(
      'https://cdn.borradh.io/clip.mp4?Signature=xyz'
    );
    expect(payload.description).toBe('Test caption');
  });

  it('a scheduled post carries Meta-native scheduling fields', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    seedPost({
      mediaType: 'image',
      mediaUrl: CDN_MEDIA,
      scheduledAt: future,
    });

    await publishSocialPost(mockDb as never, INPUT);

    const photo = captureAllRequests(mockFetch).find(
      (r) => r.endpointId === 'pages.publishPhoto'
    );
    expect(photo, 'no photos request was made').toBeDefined();

    const payload = expectMatchesContract(
      photo as NonNullable<typeof photo>,
      'pages.publishPhoto'
    );

    // `publishSocialPost` destructures `scheduledAt` off the post and forwards
    // it, so a future date ALWAYS produces these two fields. Asserting them
    // unconditionally is the point — a conditional assertion here would let the
    // test pass while native scheduling silently stopped working.
    //
    // Meta wants UNIX SECONDS as a string: milliseconds are accepted and
    // schedule the post ~50,000 years out.
    expect(String(payload.scheduled_publish_time)).toMatch(/^\d{10}$/);
    expect(Number(payload.scheduled_publish_time)).toBe(
      Math.floor(future.getTime() / 1000)
    );
    expect(payload.published).toBe('false');
  });
});
