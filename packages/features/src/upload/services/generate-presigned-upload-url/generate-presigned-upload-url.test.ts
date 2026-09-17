import {
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { generatePresignedUploadUrl } from './generate-presigned-upload-url.service.js';

describe('generatePresignedUploadUrl', () => {
  const mockStorage = {
    getOrgAssetsBucket: vi.fn().mockReturnValue('test-org-assets-bucket'),
    getPublicAssetsBucket: vi.fn().mockReturnValue('test-public-assets-bucket'),
    getS3Region: vi.fn().mockReturnValue('us-east-1'),
    getPresignedUploadUrl: vi
      .fn()
      .mockResolvedValue('https://s3.amazonaws.com/presigned-upload-url'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validOrgVideoInput = {
    filename: 'my-video.mp4',
    contentType: 'video/mp4',
    type: 'video' as const,
    purpose: 'org-asset' as const,
    userId: 'user_123',
    organizationId: 'org_123',
  };

  const validProfileImageInput = {
    filename: 'avatar.png',
    contentType: 'image/png',
    type: 'image' as const,
    purpose: 'profile' as const,
    userId: 'user_123',
  };

  it('should generate upload URL for org video asset', async () => {
    const result = await generatePresignedUploadUrl(
      mockStorage as never,
      validOrgVideoInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toBe(
        'https://s3.amazonaws.com/presigned-upload-url'
      );
      expect(result.data.bucket).toBe('test-org-assets-bucket');
      expect(result.data.region).toBe('us-east-1');
      expect(result.data.isPublic).toBe(false);
      expect(result.data.publicUrl).toBeUndefined();
      expect(result.data.expiresIn).toBe(3600);
      expect(result.data.key).toContain('org_123/videos/user_123/');
      expect(result.data.key).toContain('.mp4');
    }

    expect(mockStorage.getPresignedUploadUrl).toHaveBeenCalledWith({
      bucket: 'test-org-assets-bucket',
      key: expect.any(String),
      contentType: 'video/mp4',
      expiresIn: 3600,
    });
  });

  it('should generate upload URL for profile image with public URL', async () => {
    const result = await generatePresignedUploadUrl(
      mockStorage as never,
      validProfileImageInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toBe(
        'https://s3.amazonaws.com/presigned-upload-url'
      );
      expect(result.data.bucket).toBe('test-public-assets-bucket');
      expect(result.data.isPublic).toBe(true);
      expect(result.data.publicUrl).toBeDefined();
      expect(result.data.publicUrl).toContain('test-public-assets-bucket');
      expect(result.data.publicUrl).toContain('us-east-1');
      expect(result.data.key).toContain('images/user_123/');
      expect(result.data.key).toContain('.png');
    }
  });

  it('should use custom expiresIn when provided', async () => {
    const inputWithExpiry = {
      ...validOrgVideoInput,
      expiresIn: 120,
    };

    const result = await generatePresignedUploadUrl(
      mockStorage as never,
      inputWithExpiry
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expiresIn).toBe(120);
    }

    expect(mockStorage.getPresignedUploadUrl).toHaveBeenCalledWith(
      expect.objectContaining({ expiresIn: 120 })
    );
  });

  it('should return VALIDATION_ERROR for invalid image content type', async () => {
    const invalidInput = {
      ...validProfileImageInput,
      contentType: 'image/bmp',
    };

    await expectResult(
      generatePresignedUploadUrl(mockStorage as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockStorage.getPresignedUploadUrl).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for invalid video content type', async () => {
    const invalidInput = {
      ...validOrgVideoInput,
      contentType: 'video/avi',
    };

    await expectResult(
      generatePresignedUploadUrl(mockStorage as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockStorage.getPresignedUploadUrl).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId on org-asset purpose', async () => {
    const invalidInput = {
      filename: 'video.mp4',
      contentType: 'video/mp4',
      type: 'video' as const,
      purpose: 'org-asset' as const,
      userId: 'user_123',
      // organizationId omitted
    };

    await expectResult(
      generatePresignedUploadUrl(mockStorage as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockStorage.getPresignedUploadUrl).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing filename', async () => {
    const invalidInput = {
      ...validOrgVideoInput,
      filename: '',
    };

    await expectResult(
      generatePresignedUploadUrl(mockStorage as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockStorage.getPresignedUploadUrl).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing contentType', async () => {
    const invalidInput = {
      ...validOrgVideoInput,
      contentType: '',
    };

    await expectResult(
      generatePresignedUploadUrl(mockStorage as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockStorage.getPresignedUploadUrl).not.toHaveBeenCalled();
  });

  it('should return INTERNAL_ERROR when presigned URL generation fails', async () => {
    mockStorage.getPresignedUploadUrl.mockRejectedValueOnce(
      new Error('S3 presign failed')
    );

    await expectResult(
      generatePresignedUploadUrl(mockStorage as never, validOrgVideoInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });

  it('should default purpose to org-asset when not provided', async () => {
    const inputWithoutPurpose = {
      filename: 'video.mp4',
      contentType: 'video/mp4',
      type: 'video' as const,
      userId: 'user_123',
      organizationId: 'org_123',
    };

    const result = await generatePresignedUploadUrl(
      mockStorage as never,
      inputWithoutPurpose
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bucket).toBe('test-org-assets-bucket');
      expect(result.data.isPublic).toBe(false);
    }
  });

  it('should accept valid image content types', async () => {
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

    for (const contentType of validTypes) {
      vi.clearAllMocks();
      const input = {
        ...validProfileImageInput,
        contentType,
      };

      const result = await generatePresignedUploadUrl(
        mockStorage as never,
        input
      );

      expect(result.success).toBe(true);
    }
  });

  it('should accept valid video content types', async () => {
    const validTypes = [
      'video/mp4',
      'video/webm',
      'video/quicktime',
      'video/x-msvideo',
    ];

    for (const contentType of validTypes) {
      vi.clearAllMocks();
      const input = {
        ...validOrgVideoInput,
        contentType,
      };

      const result = await generatePresignedUploadUrl(
        mockStorage as never,
        input
      );

      expect(result.success).toBe(true);
    }
  });
});
