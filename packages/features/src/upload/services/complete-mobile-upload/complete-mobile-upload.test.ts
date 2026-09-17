import {
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { completeMobileUpload } from './complete-mobile-upload.service.js';

describe('completeMobileUpload', () => {
  const mockRedis = {
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    ttl: vi.fn().mockResolvedValue(600),
  };

  const mockStorage = {
    getS3Region: vi.fn().mockReturnValue('us-east-1'),
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

  it('should complete upload successfully', async () => {
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(mockTokenData));

    const result = await completeMobileUpload(
      mockRedis as never,
      mockStorage as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
      expect(result.data.url).toContain('test-org-assets-bucket');
      expect(result.data.url).toContain('us-east-1');
      expect(result.data.url).toContain(mockTokenData.key);
    }

    // Should get token data, get TTL, update token, update status
    expect(mockRedis.get).toHaveBeenCalledWith(`upload:${validInput.token}`);
    expect(mockRedis.ttl).toHaveBeenCalled();
    // Should call set twice: once to update token data, once to update status
    expect(mockRedis.set).toHaveBeenCalledTimes(2);
  });

  it('should update token data with completed status and url', async () => {
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(mockTokenData));

    await completeMobileUpload(
      mockRedis as never,
      mockStorage as never,
      validInput
    );

    // First set call updates the token data
    const tokenUpdateCall = mockRedis.set.mock.calls[0];
    const updatedTokenData = JSON.parse(tokenUpdateCall[1] as string);
    expect(updatedTokenData.status).toBe('completed');
    expect(updatedTokenData.url).toBeDefined();

    // Second set call updates the status key
    const statusUpdateCall = mockRedis.set.mock.calls[1];
    expect(statusUpdateCall[0]).toContain('upload-status:video_123');
    const statusData = JSON.parse(statusUpdateCall[1] as string);
    expect(statusData.status).toBe('completed');
    expect(statusData.url).toBeDefined();
  });

  it('should return NOT_FOUND when token is invalid or expired', async () => {
    mockRedis.get.mockResolvedValueOnce(null);

    await expectResult(
      completeMobileUpload(mockRedis as never, mockStorage as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty token', async () => {
    const invalidInput = { token: '' };

    await expectResult(
      completeMobileUpload(
        mockRedis as never,
        mockStorage as never,
        invalidInput
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockRedis.get).not.toHaveBeenCalled();
  });

  it('should return INTERNAL_ERROR on Redis failure', async () => {
    mockRedis.get.mockRejectedValueOnce(new Error('Redis connection refused'));

    await expectResult(
      completeMobileUpload(mockRedis as never, mockStorage as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });

  it('should preserve remaining TTL when updating token', async () => {
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(mockTokenData));
    mockRedis.ttl.mockResolvedValueOnce(450); // 450 seconds remaining

    await completeMobileUpload(
      mockRedis as never,
      mockStorage as never,
      validInput
    );

    // Token update should use remaining TTL
    const tokenUpdateCall = mockRedis.set.mock.calls[0];
    expect(tokenUpdateCall[3]).toBe(450);
  });

  it('should accept optional contentType', async () => {
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(mockTokenData));

    const inputWithContentType = {
      ...validInput,
      contentType: 'video/mp4',
    };

    const result = await completeMobileUpload(
      mockRedis as never,
      mockStorage as never,
      inputWithContentType
    );

    expect(result.success).toBe(true);
  });
});
