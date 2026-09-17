import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { AdErrorCodes } from '../../models/index.js';

import { resolveMediaAsset } from './resolve-media-asset.js';

const makeDb = (
  videoResult: unknown,
  assetResult: unknown,
  graphicResult: unknown = null
) => ({
  query: {
    video: { findFirst: vi.fn().mockResolvedValue(videoResult) },
    asset: { findFirst: vi.fn().mockResolvedValue(assetResult) },
    graphic: { findFirst: vi.fn().mockResolvedValue(graphicResult) },
  },
});

describe('resolveMediaAsset', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns video when found and ready', async () => {
    const db = makeDb(
      {
        id: 'v1',
        status: 'ready',
        blobUrl: 'https://s3/video.mp4',
        title: 'My Video',
      },
      null
    );

    const result = await resolveMediaAsset(db as never, 'v1', 'Fallback');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mediaBlobUrl).toBe('https://s3/video.mp4');
      expect(result.data.mediaTitle).toBe('My Video');
      expect(result.data.assetType).toBe('video');
    }
  });

  it('uses fallback name when video has no title', async () => {
    const db = makeDb(
      {
        id: 'v1',
        status: 'ready',
        blobUrl: 'https://s3/video.mp4',
        title: null,
      },
      null
    );

    const result = await resolveMediaAsset(db as never, 'v1', 'Fallback Name');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mediaTitle).toBe('Fallback Name');
    }
  });

  it('returns VIDEO_NOT_READY when video status is not ready', async () => {
    const db = makeDb(
      {
        id: 'v1',
        status: 'processing',
        blobUrl: 'https://s3/video.mp4',
        title: 'T',
      },
      null
    );

    const result = await resolveMediaAsset(db as never, 'v1', 'Fallback');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(AdErrorCodes.VIDEO_NOT_READY);
    }
  });

  it('returns VIDEO_NOT_READY when video has no blobUrl', async () => {
    const db = makeDb(
      { id: 'v1', status: 'ready', blobUrl: null, title: 'T' },
      null
    );

    const result = await resolveMediaAsset(db as never, 'v1', 'Fallback');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(AdErrorCodes.VIDEO_NOT_READY);
    }
  });

  it('falls back to asset table when video not found', async () => {
    const db = makeDb(null, {
      id: 'a1',
      blobUrl: 'https://s3/image.jpg',
      name: 'My Image',
      type: 'image',
    });

    const result = await resolveMediaAsset(db as never, 'a1', 'Fallback');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mediaBlobUrl).toBe('https://s3/image.jpg');
      expect(result.data.mediaTitle).toBe('My Image');
      expect(result.data.assetType).toBe('image');
    }
  });

  it('returns VIDEO_NOT_FOUND when neither video nor asset exists', async () => {
    const db = makeDb(null, null);

    const result = await resolveMediaAsset(
      db as never,
      'missing-id',
      'Fallback'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(AdErrorCodes.VIDEO_NOT_FOUND);
    }
  });

  it('returns VIDEO_NOT_READY when asset has no blobUrl', async () => {
    const db = makeDb(null, {
      id: 'a1',
      blobUrl: null,
      name: 'Image',
      type: 'image',
    });

    const result = await resolveMediaAsset(db as never, 'a1', 'Fallback');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(AdErrorCodes.VIDEO_NOT_READY);
    }
  });

  it('detects asset type correctly', async () => {
    const db = makeDb(null, {
      id: 'a1',
      blobUrl: 'https://s3/vid.mp4',
      name: 'A Video Asset',
      type: 'video',
    });

    const result = await resolveMediaAsset(db as never, 'a1', 'Fallback');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assetType).toBe('video');
    }
  });

  it('falls back to the graphic table (image creative) when ready', async () => {
    const db = makeDb(null, null, {
      title: 'Offer Ad',
      status: 'ready',
      outputs: [{ status: 'success', url: 'https://s3/org/graphics/g1/0.png' }],
    });

    const result = await resolveMediaAsset(db as never, 'g1', 'Fallback');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mediaBlobUrl).toBe('https://s3/org/graphics/g1/0.png');
      expect(result.data.mediaTitle).toBe('Offer Ad');
      expect(result.data.assetType).toBe('image');
    }
  });

  it('returns VIDEO_NOT_READY when the graphic is still rendering', async () => {
    const db = makeDb(null, null, {
      title: 'Offer Ad',
      status: 'rendering',
      outputs: null,
    });

    const result = await resolveMediaAsset(db as never, 'g1', 'Fallback');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(AdErrorCodes.VIDEO_NOT_READY);
    }
  });
});
