import {
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { generatePresignedDownloadUrl } from './generate-presigned-download-url.service.js';

describe('generatePresignedDownloadUrl', () => {
  const mockStorage = {
    getOrgAssetsBucket: vi.fn().mockReturnValue('test-org-assets-bucket'),
    getPublicAssetsBucket: vi.fn().mockReturnValue('test-public-assets-bucket'),
    getPresignedDownloadUrl: vi
      .fn()
      .mockResolvedValue('https://s3.amazonaws.com/presigned-download-url'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validOrgInput = {
    key: 'org_123/videos/user_123/1234567890-abcdef.mp4',
    bucket: 'test-org-assets-bucket',
    userId: 'user_123',
    organizationId: 'org_123',
  };

  const validPublicInput = {
    key: 'images/user_123/1234567890-abcdef.png',
    bucket: 'test-public-assets-bucket',
    userId: 'user_123',
  };

  it('should generate download URL for org asset', async () => {
    const result = await generatePresignedDownloadUrl(
      mockStorage as never,
      validOrgInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toBe(
        'https://s3.amazonaws.com/presigned-download-url'
      );
      expect(result.data.key).toBe(validOrgInput.key);
      expect(result.data.bucket).toBe('test-org-assets-bucket');
      expect(result.data.expiresIn).toBe(3600);
    }

    expect(mockStorage.getPresignedDownloadUrl).toHaveBeenCalledWith({
      bucket: 'test-org-assets-bucket',
      key: validOrgInput.key,
      expiresIn: 3600,
    });
  });

  it('should generate download URL for public asset', async () => {
    const result = await generatePresignedDownloadUrl(
      mockStorage as never,
      validPublicInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toBe(
        'https://s3.amazonaws.com/presigned-download-url'
      );
      expect(result.data.key).toBe(validPublicInput.key);
      expect(result.data.bucket).toBe('test-public-assets-bucket');
    }
  });

  it('should use custom expiresIn when provided', async () => {
    const inputWithExpiry = {
      ...validOrgInput,
      expiresIn: 7200,
    };

    const result = await generatePresignedDownloadUrl(
      mockStorage as never,
      inputWithExpiry
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expiresIn).toBe(7200);
    }

    expect(mockStorage.getPresignedDownloadUrl).toHaveBeenCalledWith(
      expect.objectContaining({ expiresIn: 7200 })
    );
  });

  it('should return FORBIDDEN when org asset key does not match organizationId', async () => {
    const invalidInput = {
      ...validOrgInput,
      key: 'other_org/videos/user_123/file.mp4',
      organizationId: 'org_123',
    };

    await expectResult(
      generatePresignedDownloadUrl(mockStorage as never, invalidInput)
    ).toFailWithCode(ErrorCodes.FORBIDDEN);

    expect(mockStorage.getPresignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('should return FORBIDDEN when public asset key does not match userId', async () => {
    const invalidInput = {
      ...validPublicInput,
      key: 'images/other_user/1234567890-abcdef.png',
      userId: 'user_123',
    };

    await expectResult(
      generatePresignedDownloadUrl(mockStorage as never, invalidInput)
    ).toFailWithCode(ErrorCodes.FORBIDDEN);

    expect(mockStorage.getPresignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId on org bucket', async () => {
    const invalidInput = {
      key: 'org_123/videos/user_123/file.mp4',
      bucket: 'test-org-assets-bucket',
      userId: 'user_123',
      // organizationId omitted
    };

    await expectResult(
      generatePresignedDownloadUrl(mockStorage as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockStorage.getPresignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing key', async () => {
    const invalidInput = {
      ...validOrgInput,
      key: '',
    };

    await expectResult(
      generatePresignedDownloadUrl(mockStorage as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockStorage.getPresignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing userId', async () => {
    const invalidInput = {
      ...validOrgInput,
      userId: '',
    };

    await expectResult(
      generatePresignedDownloadUrl(mockStorage as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockStorage.getPresignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('should return INTERNAL_ERROR when presigned URL generation fails', async () => {
    mockStorage.getPresignedDownloadUrl.mockRejectedValueOnce(
      new Error('S3 presign failed')
    );

    await expectResult(
      generatePresignedDownloadUrl(mockStorage as never, validOrgInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });

  it('should default bucket to org assets bucket when not provided', async () => {
    const inputWithoutBucket = {
      key: 'org_123/videos/user_123/file.mp4',
      userId: 'user_123',
      organizationId: 'org_123',
    };

    const result = await generatePresignedDownloadUrl(
      mockStorage as never,
      inputWithoutBucket
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bucket).toBe('test-org-assets-bucket');
    }
  });
});
