import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import type { ForgotPasswordAuthApi } from './forgot-password.service.js';
import { forgotPassword } from './forgot-password.service.js';

describe('forgotPassword', () => {
  let mockAuthApi: ForgotPasswordAuthApi;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthApi = {
      requestPasswordReset: vi.fn(),
    } as unknown as ForgotPasswordAuthApi;
  });

  const validInput = {
    email: 'user@example.com',
    redirectTo: 'https://app.example.com/reset-password',
  };

  it('should return success with valid input', async () => {
    vi.mocked(mockAuthApi.requestPasswordReset).mockResolvedValueOnce({
      status: true,
    });

    const result = await forgotPassword(mockAuthApi, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
    }

    expect(mockAuthApi.requestPasswordReset).toHaveBeenCalledWith({
      body: {
        email: validInput.email,
        redirectTo: validInput.redirectTo,
      },
    });
  });

  it('should return success without redirectTo', async () => {
    vi.mocked(mockAuthApi.requestPasswordReset).mockResolvedValueOnce({
      status: true,
    });

    const result = await forgotPassword(mockAuthApi, {
      email: 'user@example.com',
    });

    expect(result.success).toBe(true);
  });

  it('should return VALIDATION_ERROR for invalid email', async () => {
    const result = await forgotPassword(mockAuthApi, {
      email: 'not-an-email',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockAuthApi.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty email', async () => {
    const result = await forgotPassword(mockAuthApi, {
      email: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockAuthApi.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for invalid redirectTo URL', async () => {
    const result = await forgotPassword(mockAuthApi, {
      email: 'user@example.com',
      redirectTo: 'not-a-url',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockAuthApi.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('should still return success when API throws (prevents email enumeration)', async () => {
    vi.mocked(mockAuthApi.requestPasswordReset).mockRejectedValueOnce(
      new Error('User not found')
    );

    const result = await forgotPassword(mockAuthApi, validInput);

    // Always returns success to prevent email enumeration
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
    }
  });
});
