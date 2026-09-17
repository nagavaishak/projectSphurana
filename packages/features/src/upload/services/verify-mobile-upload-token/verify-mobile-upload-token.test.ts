import {
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { verifyMobileUploadToken } from './verify-mobile-upload-token.service.js';

describe('verifyMobileUploadToken', () => {
  const mockRedis = {
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    ttl: vi.fn().mockResolvedValue(900),
  };

  const mockStorage = {
    getPresignedUploadUrl: vi
      .fn()
      .mockResolvedValue('https://s3.amazonaws.com/presigned-upload-url'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validInput = {
    token: 'valid-token-123',
  };

  const mockTokenData = {
    videoId: 'video_123',
    organizationId: 'org_123',
    userId: 'user_123',
    bucket: 'test-org-assets-bucket',
    key: 'org_123/videos/user_123/1234567890-abcdef.mp4',
    status: 'pending',
  };

  it('should verify token and return upload URL', async () => {
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(mockTokenData));

    const result = await verifyMobileUploadToken(
      mockRedis as never,
      mockStorage as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.uploadUrl).toBe(
        'https://s3.amazonaws.com/presigned-upload-url'
      );
      expect(result.data.key).toBe(mockTokenData.key);
      expect(result.data.contentType).toBe('video/mp4');
      expect(result.data.videoId).toBe('video_123');
    }

    expect(mockRedis.get).toHaveBeenCalledWith(`upload:${validInput.token}`);
    expect(mockStorage.getPresignedUploadUrl).toHaveBeenCalledWith({
      bucket: mockTokenData.bucket,
      key: mockTokenData.key,
      contentType: 'video/mp4',
      expiresIn: 900,
    });
  });

  it('should return NOT_FOUND when token is invalid or expired', async () => {
    mockRedis.get.mockResolvedValueOnce(null);

    await expectResult(
      verifyMobileUploadToken(
        mockRedis as never,
        mockStorage as never,
        validInput
      )
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(mockStorage.getPresignedUploadUrl).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty token', async () => {
    const invalidInput = { token: '' };

    await expectResult(
      verifyMobileUploadToken(
        mockRedis as never,
        mockStorage as never,
        invalidInput
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockRedis.get).not.toHaveBeenCalled();
    expect(mockStorage.getPresignedUploadUrl).not.toHaveBeenCalled();
  });

  it('should return INTERNAL_ERROR when presigned URL generation fails', async () => {
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(mockTokenData));
    mockStorage.getPresignedUploadUrl.mockRejectedValueOnce(
      new Error('S3 presign failed')
    );

    await expectResult(
      verifyMobileUploadToken(
        mockRedis as never,
        mockStorage as never,
        validInput
      )
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });

  it('should return INTERNAL_ERROR on Redis failure', async () => {
    mockRedis.get.mockRejectedValueOnce(new Error('Redis connection refused'));

    await expectResult(
      verifyMobileUploadToken(
        mockRedis as never,
        mockStorage as never,
        validInput
      )
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
