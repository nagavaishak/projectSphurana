import {
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { signMultipartUploadParts } from './sign-multipart-upload-parts.service.js';

describe('signMultipartUploadParts', () => {
  const mockStorage = {
    getOrgAssetsBucket: vi.fn().mockReturnValue('test-org-assets-bucket'),
    getPublicAssetsBucket: vi.fn().mockReturnValue('test-public-assets-bucket'),
    getPresignedMultipartUploadPartUrl: vi
      .fn()
      .mockImplementation(({ partNumber }) =>
        Promise.resolve(`https://s3.test/part-${partNumber}`)
      ),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('signs unique requested parts for an allowed org key', async () => {
    const result = await signMultipartUploadParts(mockStorage as never, {
      key: 'org_123/videos/user_123/123-abc.mp4',
      uploadId: 'upload-1',
      type: 'video',
      purpose: 'org-asset',
      partNumbers: [3, 1, 3],
      userId: 'user_123',
      organizationId: 'org_123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expiresIn).toBe(3600);
      expect(result.data.parts).toEqual([
        { partNumber: 1, url: 'https://s3.test/part-1' },
        { partNumber: 3, url: 'https://s3.test/part-3' },
      ]);
    }

    expect(mockStorage.getPresignedMultipartUploadPartUrl).toHaveBeenCalledWith(
      {
        bucket: 'test-org-assets-bucket',
        key: 'org_123/videos/user_123/123-abc.mp4',
        uploadId: 'upload-1',
        partNumber: 1,
        expiresIn: 3600,
      }
    );
  });

  it('rejects keys outside the authenticated upload prefix', async () => {
    await expectResult(
      signMultipartUploadParts(mockStorage as never, {
        key: 'org_999/videos/user_123/123-abc.mp4',
        uploadId: 'upload-1',
        type: 'video',
        purpose: 'org-asset',
        partNumbers: [1],
        userId: 'user_123',
        organizationId: 'org_123',
      })
    ).toFailWithCode(ErrorCodes.FORBIDDEN);

    expect(
      mockStorage.getPresignedMultipartUploadPartUrl
    ).not.toHaveBeenCalled();
  });

  it('uses the public bucket for profile uploads', async () => {
    const result = await signMultipartUploadParts(mockStorage as never, {
      key: 'images/user_123/123-abc.png',
      uploadId: 'upload-1',
      type: 'image',
      purpose: 'profile',
      partNumbers: [1],
      expiresIn: 120,
      userId: 'user_123',
    });

    expect(result.success).toBe(true);
    expect(mockStorage.getPresignedMultipartUploadPartUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: 'test-public-assets-bucket',
        expiresIn: 120,
      })
    );
  });

  it('returns INTERNAL_ERROR when part signing fails', async () => {
    mockStorage.getPresignedMultipartUploadPartUrl.mockRejectedValueOnce(
      new Error('S3 failed')
    );

    await expectResult(
      signMultipartUploadParts(mockStorage as never, {
        key: 'org_123/videos/user_123/123-abc.mp4',
        uploadId: 'upload-1',
        type: 'video',
        purpose: 'org-asset',
        partNumbers: [1],
        userId: 'user_123',
        organizationId: 'org_123',
      })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
