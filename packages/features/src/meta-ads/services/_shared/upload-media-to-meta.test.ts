import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { AdErrorCodes } from '../../models/index.js';

// `@borradh-workspace/storage` is a canonically aliased mock (vite.config.ts) —
// no file-local `vi.mock` (it would leak under `isolate: false`). The canonical
// defaults are sufficient: `getFreshDownloadUrl` tolerates `parseS3Url` → null
// (falls back to the org bucket + pathname) and the presigned URL value isn't
// asserted here — only that Meta's `uploadImage`/`uploadVideo` receive a string.

import { uploadMediaToMeta } from './upload-media-to-meta.js';

const createMockMetaService = () => ({
  uploadImage: vi.fn(),
  uploadVideo: vi.fn(),
  waitForVideoReady: vi.fn(),
});

describe('uploadMediaToMeta', () => {
  let metaService: ReturnType<typeof createMockMetaService>;

  beforeEach(() => {
    vi.clearAllMocks();
    metaService = createMockMetaService();
  });

  it('uploads image and returns hash', async () => {
    metaService.uploadImage.mockResolvedValueOnce({ imageHash: 'hash_abc' });

    const result = await uploadMediaToMeta(metaService as never, {
      mediaBlobUrl: 'https://s3/image.jpg',
      mediaTitle: 'Test Image',
      assetType: 'image',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metaImageHash).toBe('hash_abc');
      expect(result.data.metaVideoId).toBeUndefined();
    }
  });

  it('uploads video and returns metaVideoId', async () => {
    metaService.uploadVideo.mockResolvedValueOnce({ videoId: 'vid_123' });
    metaService.waitForVideoReady.mockResolvedValueOnce({
      isReady: true,
      thumbnailUrl: 'https://thumb.test/thumb.jpg',
    });

    const result = await uploadMediaToMeta(metaService as never, {
      mediaBlobUrl: 'https://s3/video.mp4',
      mediaTitle: 'Test Video',
      assetType: 'video',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metaVideoId).toBe('vid_123');
      expect(result.data.thumbnailUrl).toBe('https://thumb.test/thumb.jpg');
    }
  });

  it('waits for video encoding to complete', async () => {
    metaService.uploadVideo.mockResolvedValueOnce({ videoId: 'vid_123' });
    metaService.waitForVideoReady.mockResolvedValueOnce({
      isReady: true,
      thumbnailUrl: null,
    });

    await uploadMediaToMeta(metaService as never, {
      mediaBlobUrl: 'https://s3/video.mp4',
      mediaTitle: 'Test Video',
      assetType: 'video',
    });

    expect(metaService.waitForVideoReady).toHaveBeenCalledWith(
      'vid_123',
      60,
      3000
    );
  });

  it('returns thumbnail URL for video', async () => {
    metaService.uploadVideo.mockResolvedValueOnce({ videoId: 'vid_123' });
    metaService.waitForVideoReady.mockResolvedValueOnce({
      isReady: true,
      thumbnailUrl: 'https://thumb.test/thumb.jpg',
    });

    const result = await uploadMediaToMeta(metaService as never, {
      mediaBlobUrl: 'https://s3/video.mp4',
      mediaTitle: 'Test Video',
      assetType: 'video',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.thumbnailUrl).toBe('https://thumb.test/thumb.jpg');
    }
  });

  it('handles encoding timeout', async () => {
    metaService.uploadVideo.mockResolvedValueOnce({ videoId: 'vid_123' });
    metaService.waitForVideoReady.mockResolvedValueOnce({
      isReady: false,
      errorMessage: 'Video encoding timed out',
    });

    const result = await uploadMediaToMeta(metaService as never, {
      mediaBlobUrl: 'https://s3/video.mp4',
      mediaTitle: 'Test Video',
      assetType: 'video',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(AdErrorCodes.META_VIDEO_UPLOAD_FAILED);
      expect(result.error.message).toContain('timed out');
    }
  });

  it('handles encoding failure with default message', async () => {
    metaService.uploadVideo.mockResolvedValueOnce({ videoId: 'vid_123' });
    metaService.waitForVideoReady.mockResolvedValueOnce({
      isReady: false,
      errorMessage: null,
    });

    const result = await uploadMediaToMeta(metaService as never, {
      mediaBlobUrl: 'https://s3/video.mp4',
      mediaTitle: 'Test Video',
      assetType: 'video',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('Video processing timed out');
    }
  });
});
