import {
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { completeMultipartUpload } from './complete-multipart-upload.service.js';

describe('completeMultipartUpload', () => {
  const mockStorage = {
    getOrgAssetsBucket: vi.fn().mockReturnValue('test-org-assets-bucket'),
    getPublicAssetsBucket: vi.fn().mockReturnValue('test-public-assets-bucket'),
    getS3Region: vi.fn().mockReturnValue('us-east-1'),
    completeMultipartUpload: vi.fn().mockResolvedValue({ etag: '"final"' }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('completes an allowed org multipart upload', async () => {
    const result = await completeMultipartUpload(mockStorage as never, {
      key: 'org_123/videos/user_123/123-abc.mp4',
      uploadId: 'upload-1',
      type: 'video',
      purpose: 'org-asset',
      parts: [
        { partNumber: 2, etag: '"part-2"' },
        { partNumber: 1, etag: '"part-1"' },
      ],
      userId: 'user_123',
      organizationId: 'org_123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.key).toBe('org_123/videos/user_123/123-abc.mp4');
      expect(result.data.bucket).toBe('test-org-assets-bucket');
      expect(result.data.region).toBe('us-east-1');
      expect(result.data.isPublic).toBe(false);
      expect(result.data.publicUrl).toBeUndefined();
      expect(result.data.etag).toBe('"final"');
    }

    expect(mockStorage.completeMultipartUpload).toHaveBeenCalledWith({
      bucket: 'test-org-assets-bucket',
      key: 'org_123/videos/user_123/123-abc.mp4',
      uploadId: 'upload-1',
      parts: [
        { partNumber: 2, etag: '"part-2"' },
        { partNumber: 1, etag: '"part-1"' },
      ],
    });
  });

  it('rejects keys outside the authenticated upload prefix', async () => {
    await expectResult(
      completeMultipartUpload(mockStorage as never, {
        key: 'org_999/videos/user_123/123-abc.mp4',
        uploadId: 'upload-1',
        type: 'video',
        purpose: 'org-asset',
        parts: [{ partNumber: 1, etag: '"part-1"' }],
        userId: 'user_123',
        organizationId: 'org_123',
      })
    ).toFailWithCode(ErrorCodes.FORBIDDEN);

    expect(mockStorage.completeMultipartUpload).not.toHaveBeenCalled();
  });

  it('returns public URL metadata for profile uploads', async () => {
    const result = await completeMultipartUpload(mockStorage as never, {
      key: 'images/user_123/123-abc.png',
      uploadId: 'upload-1',
      type: 'image',
      purpose: 'profile',
      parts: [{ partNumber: 1, etag: '"part-1"' }],
      userId: 'user_123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bucket).toBe('test-public-assets-bucket');
      expect(result.data.publicUrl).toContain('test-public-assets-bucket');
    }
  });

  it('returns INTERNAL_ERROR when S3 completion fails', async () => {
    mockStorage.completeMultipartUpload.mockRejectedValueOnce(
      new Error('S3 failed')
    );

    await expectResult(
      completeMultipartUpload(mockStorage as never, {
        key: 'org_123/videos/user_123/123-abc.mp4',
        uploadId: 'upload-1',
        type: 'video',
        purpose: 'org-asset',
        parts: [{ partNumber: 1, etag: '"part-1"' }],
        userId: 'user_123',
        organizationId: 'org_123',
      })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
