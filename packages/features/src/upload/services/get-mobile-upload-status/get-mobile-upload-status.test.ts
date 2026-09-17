import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { getMobileUploadStatus } from './get-mobile-upload-status.service.js';

describe('getMobileUploadStatus', () => {
  const mockRedis = {
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    ttl: vi.fn().mockResolvedValue(900),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validInput = {
    videoId: 'video_123',
  };

  it('should return completed status when upload is done', async () => {
    const statusData = {
      status: 'completed',
      url: 'https://bucket.s3.us-east-1.amazonaws.com/org/videos/file.mp4',
    };

    mockRedis.get.mockResolvedValueOnce(JSON.stringify(statusData));

    const result = await getMobileUploadStatus(mockRedis as never, validInput);

    expect(result.status).toBe('completed');
    expect(result.url).toBe(statusData.url);
    expect(mockRedis.get).toHaveBeenCalledWith(
      `upload-status:${validInput.videoId}`
    );
  });

  it('should return pending status with token when upload is in progress', async () => {
    const statusData = {
      status: 'pending',
      token: 'some-token-123',
    };

    mockRedis.get.mockResolvedValueOnce(JSON.stringify(statusData));

    const result = await getMobileUploadStatus(mockRedis as never, validInput);

    expect(result.status).toBe('pending');
    expect(result.token).toBe('some-token-123');
  });

  it('should return pending status when no data in Redis', async () => {
    mockRedis.get.mockResolvedValueOnce(null);

    const result = await getMobileUploadStatus(mockRedis as never, validInput);

    expect(result.status).toBe('pending');
  });

  it('should return pending status for invalid input (empty videoId)', async () => {
    const invalidInput = { videoId: '' };

    const result = await getMobileUploadStatus(
      mockRedis as never,
      invalidInput
    );

    expect(result.status).toBe('pending');
    expect(mockRedis.get).not.toHaveBeenCalled();
  });

  it('should return pending status on Redis error (fails open)', async () => {
    mockRedis.get.mockRejectedValueOnce(new Error('Redis connection refused'));

    const result = await getMobileUploadStatus(mockRedis as never, validInput);

    expect(result.status).toBe('pending');
  });

  it('should return pending status when Redis returns invalid JSON', async () => {
    mockRedis.get.mockResolvedValueOnce('not-valid-json{{{');

    const result = await getMobileUploadStatus(mockRedis as never, validInput);

    // JSON.parse will throw, caught by the catch block → fails open
    expect(result.status).toBe('pending');
  });
});
