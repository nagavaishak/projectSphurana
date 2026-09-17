import {
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { createMobileUploadToken } from './create-mobile-upload-token.service.js';

describe('createMobileUploadToken', () => {
  const mockRedis = {
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    ttl: vi.fn().mockResolvedValue(900),
  };

  const mockStorage = {
    getOrgAssetsBucket: vi.fn().mockReturnValue('test-org-assets-bucket'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validInput = {
    videoId: 'video_123',
    userId: 'user_123',
    organizationId: 'org_123',
  };

  it('should create token successfully', async () => {
    const result = await createMobileUploadToken(
      mockRedis as never,
      mockStorage as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.token).toBeDefined();
      expect(result.data.token).toEqual(expect.any(String));
      expect(result.data.deepLinkUrl).toContain('borradh://upload?token=');
      expect(result.data.deepLinkUrl).toContain(result.data.token);
      expect(result.data.expiresIn).toBe(900);
    }

    // Should call redis.set twice: once for token data, once for status
    expect(mockRedis.set).toHaveBeenCalledTimes(2);
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringContaining('upload:'),
      expect.any(String),
      'EX',
      900
    );
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringContaining('upload-status:video_123'),
      expect.any(String),
      'EX',
      900
    );
  });

  it('should store correct token data in Redis', async () => {
    const result = await createMobileUploadToken(
      mockRedis as never,
      mockStorage as never,
      validInput
    );

    expect(result.success).toBe(true);

    // Verify the token data stored contains correct fields
    const tokenDataCall = mockRedis.set.mock.calls[0];
    const storedData = JSON.parse(tokenDataCall[1] as string);
    expect(storedData.videoId).toBe('video_123');
    expect(storedData.organizationId).toBe('org_123');
    expect(storedData.userId).toBe('user_123');
    expect(storedData.bucket).toBe('test-org-assets-bucket');
    expect(storedData.status).toBe('pending');
    expect(storedData.key).toContain('org_123/videos/user_123/');
  });

  it('should return VALIDATION_ERROR for missing videoId', async () => {
    const invalidInput = {
      ...validInput,
      videoId: '',
    };

    await expectResult(
      createMobileUploadToken(
        mockRedis as never,
        mockStorage as never,
        invalidInput
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing userId', async () => {
    const invalidInput = {
      ...validInput,
      userId: '',
    };

    await expectResult(
      createMobileUploadToken(
        mockRedis as never,
        mockStorage as never,
        invalidInput
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      ...validInput,
      organizationId: '',
    };

    await expectResult(
      createMobileUploadToken(
        mockRedis as never,
        mockStorage as never,
        invalidInput
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('should return INTERNAL_ERROR on Redis failure', async () => {
    mockRedis.set.mockRejectedValueOnce(new Error('Redis connection refused'));

    await expectResult(
      createMobileUploadToken(
        mockRedis as never,
        mockStorage as never,
        validInput
      )
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });

  it('should accept optional contentType', async () => {
    const inputWithContentType = {
      ...validInput,
      contentType: 'video/mp4',
    };

    const result = await createMobileUploadToken(
      mockRedis as never,
      mockStorage as never,
      inputWithContentType
    );

    expect(result.success).toBe(true);
  });
});
