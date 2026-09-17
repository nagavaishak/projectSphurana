import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import type { VerifyEmailAuthApi } from './verify-email.service.js';
import { verifyEmail } from './verify-email.service.js';

const mockHeaders = () => ({ get: vi.fn().mockReturnValue(null) });

describe('verifyEmail', () => {
  let mockAuthApi: VerifyEmailAuthApi;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthApi = {
      verifyEmail: vi.fn(),
    } as unknown as VerifyEmailAuthApi;
  });

  it('should verify email successfully', async () => {
    const input = {
      token: 'valid-verification-token',
    };

    const mockUser = {
      id: 'user-123',
      email: 'test@example.com',
      name: 'Test User',
      emailVerified: true,
    };

    const mockResponse = {
      ok: true,
      headers: mockHeaders(),
      json: vi.fn().mockResolvedValue({
        status: true,
        user: mockUser,
      }),
    };

    vi.mocked(mockAuthApi.verifyEmail).mockResolvedValueOnce(
      mockResponse as Awaited<ReturnType<typeof mockAuthApi.verifyEmail>>
    );

    const result = await verifyEmail(mockAuthApi, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.user).not.toBeNull();
      expect(result.data.user?.email).toBe('test@example.com');
      expect(result.data.user?.emailVerified).toBe(true);
    }
    expect(mockAuthApi.verifyEmail).toHaveBeenCalledWith({
      query: { token: input.token },
      asResponse: true,
    });
  });

  it('should return success with null user when user data not returned', async () => {
    const input = {
      token: 'valid-token',
    };

    const mockResponse = {
      ok: true,
      headers: mockHeaders(),
      json: vi.fn().mockResolvedValue({
        status: true,
        user: null,
      }),
    };

    vi.mocked(mockAuthApi.verifyEmail).mockResolvedValueOnce(
      mockResponse as Awaited<ReturnType<typeof mockAuthApi.verifyEmail>>
    );

    const result = await verifyEmail(mockAuthApi, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.user).toBeNull();
    }
  });

  it('should return INVALID_INPUT for invalid token', async () => {
    const input = {
      token: 'invalid-token',
    };

    const mockResponse = {
      ok: true,
      headers: mockHeaders(),
      json: vi.fn().mockResolvedValue({
        status: false,
      }),
    };

    vi.mocked(mockAuthApi.verifyEmail).mockResolvedValueOnce(
      mockResponse as Awaited<ReturnType<typeof mockAuthApi.verifyEmail>>
    );

    const result = await verifyEmail(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_INPUT);
      expect(result.error.message).toContain('Invalid or expired');
    }
  });

  it('should return INVALID_INPUT when response is not ok', async () => {
    const input = {
      token: 'expired-token',
    };

    const mockResponse = {
      ok: false,
      headers: mockHeaders(),
      json: vi.fn().mockResolvedValue({}),
    };

    vi.mocked(mockAuthApi.verifyEmail).mockResolvedValueOnce(
      mockResponse as Awaited<ReturnType<typeof mockAuthApi.verifyEmail>>
    );

    const result = await verifyEmail(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_INPUT);
    }
  });

  it('should return VALIDATION_ERROR for empty token', async () => {
    const input = {
      token: '',
    };

    const result = await verifyEmail(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockAuthApi.verifyEmail).not.toHaveBeenCalled();
  });

  it('should return INTERNAL_ERROR on unexpected error', async () => {
    const input = {
      token: 'valid-token',
    };

    vi.mocked(mockAuthApi.verifyEmail).mockRejectedValueOnce(
      new Error('Network error')
    );

    const result = await verifyEmail(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
