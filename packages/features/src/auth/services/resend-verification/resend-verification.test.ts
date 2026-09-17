import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import type { ResendVerificationAuthApi } from './resend-verification.service.js';
import { resendVerification } from './resend-verification.service.js';

describe('resendVerification', () => {
  let mockAuthApi: ResendVerificationAuthApi;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthApi = {
      sendVerificationEmail: vi.fn(),
    } as unknown as ResendVerificationAuthApi;
  });

  it('should resend verification email successfully', async () => {
    const input = {
      email: 'test@example.com',
      callbackURL: '/onboarding',
    };

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ status: true }),
    };

    vi.mocked(mockAuthApi.sendVerificationEmail).mockResolvedValueOnce(
      mockResponse as Awaited<
        ReturnType<typeof mockAuthApi.sendVerificationEmail>
      >
    );

    const result = await resendVerification(mockAuthApi, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
      expect(result.data.message).toContain('Verification email sent');
    }
    expect(mockAuthApi.sendVerificationEmail).toHaveBeenCalledWith({
      body: {
        email: input.email,
        callbackURL: input.callbackURL,
      },
      asResponse: true,
    });
  });

  it('should return success even when email not found (security)', async () => {
    const input = {
      email: 'nonexistent@example.com',
    };

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ status: false }),
    };

    vi.mocked(mockAuthApi.sendVerificationEmail).mockResolvedValueOnce(
      mockResponse as Awaited<
        ReturnType<typeof mockAuthApi.sendVerificationEmail>
      >
    );

    const result = await resendVerification(mockAuthApi, input);

    // Should still return success to not reveal if email exists
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
    }
  });

  it('should return success even when response is not ok (security)', async () => {
    const input = {
      email: 'test@example.com',
    };

    const mockResponse = {
      ok: false,
      json: vi.fn().mockResolvedValue({}),
    };

    vi.mocked(mockAuthApi.sendVerificationEmail).mockResolvedValueOnce(
      mockResponse as Awaited<
        ReturnType<typeof mockAuthApi.sendVerificationEmail>
      >
    );

    const result = await resendVerification(mockAuthApi, input);

    // Should still return success to not reveal internal state
    expect(result.success).toBe(true);
  });

  it('should return VALIDATION_ERROR for invalid email', async () => {
    const input = {
      email: 'invalid-email',
    };

    const result = await resendVerification(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockAuthApi.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('should return INTERNAL_ERROR on unexpected error', async () => {
    const input = {
      email: 'test@example.com',
    };

    vi.mocked(mockAuthApi.sendVerificationEmail).mockRejectedValueOnce(
      new Error('Network error')
    );

    const result = await resendVerification(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('should use default callbackURL when not provided', async () => {
    const input = {
      email: 'test@example.com',
    };

    const mockResponse = {
      ok: true,
      json: vi.fn().mockResolvedValue({ status: true }),
    };

    vi.mocked(mockAuthApi.sendVerificationEmail).mockResolvedValueOnce(
      mockResponse as Awaited<
        ReturnType<typeof mockAuthApi.sendVerificationEmail>
      >
    );

    await resendVerification(mockAuthApi, input);

    expect(mockAuthApi.sendVerificationEmail).toHaveBeenCalledWith({
      body: {
        email: input.email,
        callbackURL: '/onboarding',
      },
      asResponse: true,
    });
  });
});
