import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { AdErrorCodes } from '../../models/index.js';
import { getAd } from './get-ad.service.js';

const mockDb = {
  query: {
    metaAd: { findFirst: vi.fn() },
    video: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    // `videoId` can point at an asset rather than a video, so the read path
    // falls back to this table — see `loadAdPreviewMedia`.
    asset: { findMany: vi.fn().mockResolvedValue([]) },
    graphic: { findFirst: vi.fn() },
  },
};

describe('getAd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validInput = {
    adId: 'ad-123',
    organizationId: 'org-789',
  };

  it('returns ad with video when found', async () => {
    const mockAd = {
      id: 'ad-123',
      organizationId: 'org-789',
      videoId: 'video-789',
      name: 'Test Ad',
      status: 'active',
    };
    const mockVideo = {
      id: 'video-789',
      title: 'Test Video',
      status: 'ready',
    };

    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(mockAd);
    mockDb.query.video.findFirst.mockResolvedValueOnce(mockVideo);

    const result = await getAd(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('ad-123');
      expect(result.data.name).toBe('Test Ad');
      expect(result.data.video).toEqual(mockVideo);
    }
  });

  it('returns ad with undefined video when neither a video nor an asset exists', async () => {
    const mockAd = {
      id: 'ad-123',
      organizationId: 'org-789',
      videoId: 'video-789',
      name: 'Test Ad',
    };

    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(mockAd);
    mockDb.query.video.findFirst.mockResolvedValueOnce(null);

    const result = await getAd(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.video).toBeUndefined();
    }
  });

  /**
   * The blank-preview bug: an ad built from an uploaded asset stores that
   * asset's id in `videoId`. The read path only joined `video`, so it found
   * nothing and the panel had no creative to show — 12 production ads across
   * 20 organisations previewed empty this way.
   */
  it('falls back to the asset table when videoId points at an asset', async () => {
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce({
      id: 'ad-123',
      organizationId: 'org-789',
      videoId: 'asset-456',
      name: 'August Laser Package',
    });
    mockDb.query.video.findFirst.mockResolvedValueOnce(null);
    mockDb.query.video.findMany.mockResolvedValueOnce([]);
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

    const result = await getAd(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.video).toMatchObject({
        blobUrl: 'https://cdn/laser.mp4',
        thumbnailUrl: 'https://cdn/laser.jpg',
        width: 1080,
        height: 1920,
      });
    }
  });

  it('returns VALIDATION_ERROR for missing adId', async () => {
    const result = await getAd(mockDb as never, {
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
    const result = await getAd(mockDb as never, {
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

    const result = await getAd(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(AdErrorCodes.AD_NOT_FOUND);
    }
  });

  it('returns AD_NOT_FOUND when ad belongs to different org', async () => {
    const mockAd = {
      id: 'ad-123',
      organizationId: 'different-org',
      videoId: 'video-789',
    };

    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(mockAd);

    const result = await getAd(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(AdErrorCodes.AD_NOT_FOUND);
      expect(result.error.message).toBe('Ad not found');
    }
  });
});
