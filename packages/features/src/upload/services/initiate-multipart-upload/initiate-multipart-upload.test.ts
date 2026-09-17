import {
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { initiateMultipartUpload } from './initiate-multipart-upload.service.js';

describe('initiateMultipartUpload', () => {
  const mockStorage = {
    getOrgAssetsBucket: vi.fn().mockReturnValue('test-org-assets-bucket'),
    getPublicAssetsBucket: vi.fn().mockReturnValue('test-public-assets-bucket'),
    getS3Region: vi.fn().mockReturnValue('us-east-1'),
    createMultipartUpload: vi.fn().mockResolvedValue({ uploadId: 'upload-1' }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initiates an org video multipart upload', async () => {
    const result = await initiateMultipartUpload(mockStorage as never, {
      filename: 'clip.mov',
      contentType: 'video/quicktime',
      type: 'video',
      purpose: 'org-asset',
      userId: 'user_123',
      organizationId: 'org_123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.uploadId).toBe('upload-1');
      expect(result.data.bucket).toBe('test-org-assets-bucket');
      expect(result.data.region).toBe('us-east-1');
      expect(result.data.isPublic).toBe(false);
      expect(result.data.publicUrl).toBeUndefined();
      expect(result.data.partSize).toBe(8 * 1024 * 1024);
      expect(result.data.expiresIn).toBe(3600);
      expect(result.data.key).toContain('org_123/videos/user_123/');
      expect(result.data.key).toContain('.mov');
    }

    expect(mockStorage.createMultipartUpload).toHaveBeenCalledWith({
      bucket: 'test-org-assets-bucket',
      key: expect.any(String),
      contentType: 'video/quicktime',
    });
  });

  it('initiates a public profile image upload', async () => {
    const result = await initiateMultipartUpload(mockStorage as never, {
      filename: 'avatar.png',
      contentType: 'image/png',
      type: 'image',
      purpose: 'profile',
      userId: 'user_123',
      partSize: 10 * 1024 * 1024,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bucket).toBe('test-public-assets-bucket');
      expect(result.data.isPublic).toBe(true);
      expect(result.data.publicUrl).toContain('test-public-assets-bucket');
      expect(result.data.partSize).toBe(10 * 1024 * 1024);
      expect(result.data.key).toContain('images/user_123/');
    }
  });

  it('rejects org uploads without an organization', async () => {
    await expectResult(
      initiateMultipartUpload(mockStorage as never, {
        filename: 'clip.mp4',
        contentType: 'video/mp4',
        type: 'video',
        purpose: 'org-asset',
        userId: 'user_123',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockStorage.createMultipartUpload).not.toHaveBeenCalled();
  });

  it('rejects invalid content types', async () => {
    await expectResult(
      initiateMultipartUpload(mockStorage as never, {
        filename: 'clip.avi',
        contentType: 'video/avi',
        type: 'video',
        purpose: 'org-asset',
        userId: 'user_123',
        organizationId: 'org_123',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockStorage.createMultipartUpload).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR when S3 initiation fails', async () => {
    mockStorage.createMultipartUpload.mockRejectedValueOnce(
      new Error('S3 failed')
    );

    await expectResult(
      initiateMultipartUpload(mockStorage as never, {
        filename: 'clip.mp4',
        contentType: 'video/mp4',
        type: 'video',
        purpose: 'org-asset',
        userId: 'user_123',
        organizationId: 'org_123',
      })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
