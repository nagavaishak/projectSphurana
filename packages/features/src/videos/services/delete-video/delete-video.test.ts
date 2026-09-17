import { isFeatureOn } from '@borradh-workspace/observability';
import { deleteObject, parseS3Url } from '@borradh-workspace/storage';
import { createMockDatabase, expectResult } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';

// `@borradh-workspace/storage` is a canonically aliased mock (vite.config.ts) —
// drive its `vi.fn()`s with `vi.mocked()` rather than a file-local `vi.mock`,
// which would leak under `isolate: false`.
const mockDeleteObject = vi.mocked(deleteObject);
const mockParseS3Url = vi.mocked(parseS3Url);

const { deleteVideo } = await import('./delete-video.service.js');

describe('deleteVideo', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isFeatureOn).mockResolvedValue(true);
    mockDb._resetMocks();
    // `.mockReset()` drops any queued `*Once` left by a prior test/sibling file
    // (which `vi.clearAllMocks()` does NOT clear), then restore the base impls.
    mockDeleteObject.mockReset();
    mockParseS3Url.mockReset();
    mockDeleteObject.mockResolvedValue(undefined);
    mockParseS3Url.mockReturnValue(null);
  });

  const validInput = {
    id: 'video_123',
  };

  /**
   * A video an ad still points at must not be deletable: the ad would be left
   * with a dangling `videoId`, and on the hard-delete path the media is gone
   * for good. Four production ads ended up in that state.
   */
  it('refuses to delete a video an ad still uses, and deletes nothing', async () => {
    mockDb.query.video.findFirst.mockResolvedValueOnce({
      id: 'video_123',
      organizationId: 'org_123',
    });
    mockDb.where.mockResolvedValueOnce([{ id: 'ad_1', name: 'Spring Offer' }]);

    const result = await deleteVideo(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.CONFLICT);
      expect(result.error.message).toContain('Spring Offer');
    }
    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should delete video successfully', async () => {
    const deletedVideo = {
      id: 'video_123',
      title: 'Test Video',
      status: 'draft',
    };

    mockDb.returning.mockResolvedValueOnce([deletedVideo]);

    const result = await deleteVideo(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.id).toBe('video_123');
    }
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith({
      deletedAt: expect.any(Date),
    });
  });

  it('should delete completed video', async () => {
    const deletedVideo = {
      id: 'video_123',
      title: 'Completed Video',
      status: 'completed',
      blobUrl: 'https://example.com/video.mp4',
    };

    mockDb.returning.mockResolvedValueOnce([deletedVideo]);

    const result = await deleteVideo(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.status).toBe('completed');
    }
  });

  it('should return null when video not found', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    const result = await deleteVideo(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });

  it('should delete video with error status', async () => {
    const deletedVideo = {
      id: 'video_123',
      title: 'Failed Video',
      status: 'error',
      errorMessage: 'Rendering failed',
    };

    mockDb.returning.mockResolvedValueOnce([deletedVideo]);

    const result = await deleteVideo(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.status).toBe('error');
    }
  });

  it('should delete video with processing status', async () => {
    const deletedVideo = {
      id: 'video_123',
      title: 'Processing Video',
      status: 'processing',
      progress: 50,
    };

    mockDb.returning.mockResolvedValueOnce([deletedVideo]);

    const result = await deleteVideo(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.status).toBe('processing');
    }
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    const invalidInput = {};

    await expectResult(
      deleteVideo(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should attempt S3 cleanup for video with blobUrl on hard-delete', async () => {
    // Hard-delete returns the pre-deletion row (deletedAt: null)
    const deletedVideo = {
      id: 'video_123',
      blobUrl: 'https://bucket.s3.us-east-1.amazonaws.com/videos/output.mp4',
      thumbnailUrl: null,
      talkingHeadUrl:
        'https://bucket.s3.us-east-1.amazonaws.com/uploads/head.mp4',
      deletedAt: null,
    };

    // Hard-delete path (feature flag OFF)
    vi.mocked(isFeatureOn).mockResolvedValue(false);

    mockParseS3Url.mockImplementation((url: string) => {
      if (url.includes('output.mp4')) {
        return { bucket: 'bucket', key: 'videos/output.mp4' };
      }
      return null;
    });

    mockDb.returning.mockResolvedValueOnce([deletedVideo]);

    const result = await deleteVideo(mockDb as never, validInput);

    expect(result.success).toBe(true);

    // Wait for fire-and-forget to resolve
    await new Promise((r) => setTimeout(r, 50));

    // Should clean up blobUrl but NOT talkingHeadUrl (user-uploaded, may be shared)
    expect(mockParseS3Url).toHaveBeenCalledWith(
      'https://bucket.s3.us-east-1.amazonaws.com/videos/output.mp4'
    );
    expect(mockDeleteObject).toHaveBeenCalledWith({
      bucket: 'bucket',
      key: 'videos/output.mp4',
    });
  });

  it('should NOT clean up S3 on soft-delete (blobUrl retained for recovery)', async () => {
    // Soft-delete sets deletedAt on the returned row
    const softDeletedVideo = {
      id: 'video_123',
      blobUrl: 'https://bucket.s3.us-east-1.amazonaws.com/videos/output.mp4',
      thumbnailUrl: null,
      deletedAt: new Date(),
    };

    // Soft-delete path (feature flag ON — default)
    mockDb.returning.mockResolvedValueOnce([softDeletedVideo]);

    const result = await deleteVideo(mockDb as never, validInput);

    expect(result.success).toBe(true);

    await new Promise((r) => setTimeout(r, 50));

    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it('should not clean up talkingHeadUrl', async () => {
    const deletedVideo = {
      id: 'video_123',
      blobUrl: null,
      thumbnailUrl: null,
      talkingHeadUrl:
        'https://bucket.s3.us-east-1.amazonaws.com/uploads/head.mp4',
    };

    mockDb.returning.mockResolvedValueOnce([deletedVideo]);

    const result = await deleteVideo(mockDb as never, validInput);

    expect(result.success).toBe(true);

    // Wait for fire-and-forget to resolve
    await new Promise((r) => setTimeout(r, 50));

    // talkingHeadUrl should NOT be passed to parseS3Url
    expect(mockParseS3Url).not.toHaveBeenCalled();
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it('should succeed even if S3 cleanup fails', async () => {
    const deletedVideo = {
      id: 'video_123',
      blobUrl: 'https://bucket.s3.us-east-1.amazonaws.com/videos/output.mp4',
      thumbnailUrl: null,
    };

    mockParseS3Url.mockReturnValue({
      bucket: 'bucket',
      key: 'videos/output.mp4',
    });
    mockDeleteObject.mockRejectedValue(new Error('S3 error'));

    mockDb.returning.mockResolvedValueOnce([deletedVideo]);

    const result = await deleteVideo(mockDb as never, validInput);

    // Delete should still succeed even though S3 cleanup failed
    expect(result.success).toBe(true);
  });

  it('should clean up both blobUrl and thumbnailUrl on hard-delete', async () => {
    // Hard-delete returns the pre-deletion row (deletedAt: null)
    const deletedVideo = {
      id: 'video_123',
      blobUrl: 'https://bucket.s3.us-east-1.amazonaws.com/videos/output.mp4',
      thumbnailUrl:
        'https://bucket.s3.us-east-1.amazonaws.com/videos/thumb.jpg',
      deletedAt: null,
    };

    // Hard-delete path (feature flag OFF)
    vi.mocked(isFeatureOn).mockResolvedValue(false);

    mockParseS3Url.mockImplementation((url: string) => {
      if (url.includes('output.mp4')) {
        return { bucket: 'bucket', key: 'videos/output.mp4' };
      }
      if (url.includes('thumb.jpg')) {
        return { bucket: 'bucket', key: 'videos/thumb.jpg' };
      }
      return null;
    });

    mockDb.returning.mockResolvedValueOnce([deletedVideo]);

    const result = await deleteVideo(mockDb as never, validInput);

    expect(result.success).toBe(true);

    // Wait for fire-and-forget to resolve
    await new Promise((r) => setTimeout(r, 50));

    expect(mockDeleteObject).toHaveBeenCalledTimes(2);
  });
});
