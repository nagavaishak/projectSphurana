import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { listAds } from './list-ads.service.js';

/**
 * Creates a mock DB for listAds tests.
 *
 * The service performs:
 * 1. syncCampaignAdsFromMeta → getMetaCredentials → db.query.metaAdsIntegration.findFirst (returns null → sync skips)
 * 2. Main ads query: db.select().from().leftJoin().where().orderBy().limit().offset()
 * 3. Count query: db.select().from().where()  (terminal)
 * 4. Services query: db.select().from().innerJoin().where()  (terminal, only if ads exist)
 */
const createListAdsMock = () => {
  const mock = {
    select: vi.fn(),
    from: vi.fn(),
    leftJoin: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
    query: {
      metaAdsIntegration: {
        findFirst: vi.fn().mockResolvedValue(null), // sync skips when no integration
        findMany: vi.fn().mockResolvedValue([]),
      },
      metaAd: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      graphic: { findMany: vi.fn().mockResolvedValue([]) },
      // `videoId` can point at an asset rather than a video, so the read path
      // resolves the leftovers from these two — see `loadAdPreviewMedia`.
      video: { findMany: vi.fn().mockResolvedValue([]) },
      asset: { findMany: vi.fn().mockResolvedValue([]) },
    },
  };

  // Default: all chainable methods return mock itself
  const resetChain = () => {
    mock.select.mockReturnValue(mock);
    mock.from.mockReturnValue(mock);
    mock.leftJoin.mockReturnValue(mock);
    mock.innerJoin.mockReturnValue(mock);
    mock.where.mockReturnValue(mock);
    mock.orderBy.mockReturnValue(mock);
    mock.limit.mockReturnValue(mock);
  };

  resetChain();

  return { mock, resetChain };
};

describe('listAds', () => {
  const { mock: mockDb, resetChain } = createListAdsMock();

  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
    // Reset query mocks
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValue(null);
    mockDb.query.metaAd.findMany.mockResolvedValue([]);
  });

  const validInput = {
    metaCampaignId: 'campaign-123',
    organizationId: 'org-789',
    limit: 20,
    offset: 0,
  };

  it('returns list of ads', async () => {
    const mockAds = [
      {
        id: 'ad-1',
        metaCampaignId: 'campaign-123',
        videoId: 'video-1',
        name: 'Ad 1',
        status: 'active',
        videoTitle: 'Video 1',
        videoThumbnailUrl: 'https://example.com/thumb1.jpg',
        videoBlobUrl: 'https://example.com/video1.mp4',
        videoDurationMs: 15000,
        metaThumbnailUrl: null,
      },
      {
        id: 'ad-2',
        metaCampaignId: 'campaign-123',
        videoId: 'video-2',
        name: 'Ad 2',
        status: 'draft',
        videoTitle: 'Video 2',
        videoThumbnailUrl: 'https://example.com/thumb2.jpg',
        videoBlobUrl: 'https://example.com/video2.mp4',
        videoDurationMs: 30000,
        metaThumbnailUrl: null,
      },
    ];

    // Query 1: Ads query → terminal at offset
    mockDb.offset.mockResolvedValueOnce(mockAds);
    // Query 2: Count query → terminal at where (2nd call to where)
    // The first where() call is from the ads query chain (returns mockDb to continue)
    // The second where() call is from the count query (returns the count result)
    mockDb.where
      .mockReturnValueOnce(mockDb) // 1st where() - ads query, continue chain
      .mockResolvedValueOnce([{ total: 2 }]); // 2nd where() - count query, return result
    // Query 3: Services query → terminal at where (3rd call)
    // select returns a new chain for services query after the count query
    mockDb.where.mockResolvedValueOnce([]); // 3rd where() - services query

    const result = await listAds(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ads).toHaveLength(2);
      expect(result.data.total).toBe(2);
      expect(result.data.ads[0].video).toEqual({
        title: 'Video 1',
        thumbnailUrl: 'https://example.com/thumb1.jpg',
        videoUrl: 'https://example.com/video1.mp4',
        duration: 15000,
        // Only asset-backed creatives carry stored dimensions; a joined video
        // row has none, and the preview measures them from the media instead.
        width: null,
        height: null,
      });
    }
  });

  /**
   * The blank-preview bug, at the list level: an ad whose `videoId` is an
   * asset id got no creative from the `video` join, so the row and the panel
   * had nothing to show.
   */
  it('resolves an ad whose videoId points at an asset', async () => {
    mockDb.offset.mockResolvedValueOnce([
      {
        id: 'ad-asset',
        name: 'August Laser Package',
        videoId: 'asset-456',
        graphicId: null,
        metaThumbnailUrl: null,
        videoTitle: null,
        videoThumbnailUrl: null,
        videoBlobUrl: null,
        videoDurationMs: null,
      },
    ]);
    mockDb.where
      .mockReturnValueOnce(mockDb)
      .mockResolvedValueOnce([{ total: 1 }]);
    mockDb.where.mockResolvedValueOnce([]);
    mockDb.query.asset.findMany.mockResolvedValueOnce([
      {
        id: 'asset-456',
        name: 'Laser clip',
        type: 'video',
        blobUrl: 'https://cdn/laser.mp4',
        thumbnailUrl: 'https://cdn/laser.jpg',
        transcodedBlobUrl: null,
        transcodeStatus: 'skipped',
        duration: 15,
        width: 1080,
        height: 1920,
        deletedAt: null,
      },
    ]);

    const result = await listAds(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ads[0].video).toEqual({
        title: 'Laser clip',
        thumbnailUrl: 'https://cdn/laser.jpg',
        videoUrl: 'https://cdn/laser.mp4',
        duration: 15000,
        width: 1080,
        height: 1920,
      });
    }
  });

  it('returns empty list when no ads exist', async () => {
    mockDb.offset.mockResolvedValueOnce([]);
    mockDb.where
      .mockReturnValueOnce(mockDb) // 1st where() - ads query
      .mockResolvedValueOnce([{ total: 0 }]); // 2nd where() - count query
    // No services query since adIds is empty

    const result = await listAds(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ads).toHaveLength(0);
      expect(result.data.total).toBe(0);
    }
  });

  it('filters ads by status when provided', async () => {
    const inputWithStatus = {
      ...validInput,
      status: 'active' as const,
    };
    const mockAds = [
      {
        id: 'ad-1',
        status: 'active',
        videoTitle: 'Video',
        videoThumbnailUrl: null,
        videoBlobUrl: null,
        videoDurationMs: null,
        metaThumbnailUrl: null,
      },
    ];

    mockDb.offset.mockResolvedValueOnce(mockAds);
    mockDb.where
      .mockReturnValueOnce(mockDb) // 1st where() - ads query
      .mockResolvedValueOnce([{ total: 1 }]); // 2nd where() - count query
    mockDb.where.mockResolvedValueOnce([]); // 3rd where() - services query

    const result = await listAds(mockDb as never, inputWithStatus);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ads).toHaveLength(1);
    }
  });

  it('returns VALIDATION_ERROR for missing metaCampaignId', async () => {
    const result = await listAds(mockDb as never, {
      ...validInput,
      metaCampaignId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await listAds(mockDb as never, {
      ...validInput,
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('uses default pagination values', async () => {
    const inputWithoutPagination = {
      metaCampaignId: 'campaign-123',
      organizationId: 'org-789',
    };

    mockDb.offset.mockResolvedValueOnce([]);
    mockDb.where
      .mockReturnValueOnce(mockDb) // 1st where() - ads query
      .mockResolvedValueOnce([{ total: 0 }]); // 2nd where() - count query

    const result = await listAds(mockDb as never, inputWithoutPagination);

    expect(result.success).toBe(true);
    expect(mockDb.limit).toHaveBeenCalled();
  });
});
