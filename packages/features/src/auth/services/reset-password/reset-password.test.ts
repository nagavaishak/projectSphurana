import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import type { ResetPasswordAuthApi } from './reset-password.service.js';
import { resetPassword } from './reset-password.service.js';

describe('resetPassword', () => {
  let mockAuthApi: ResetPasswordAuthApi;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthApi = {
      resetPassword: vi.fn(),
    } as unknown as ResetPasswordAuthApi;
  });

  const validInput = {
    token: 'valid-reset-token-abc123',
    newPassword: 'NewSecurePassword123!',
  };

  it('should reset password with valid input', async () => {
    vi.mocked(mockAuthApi.resetPassword).mockResolvedValueOnce({
      status: true,
    });

    const result = await resetPassword(mockAuthApi, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
    }

    expect(mockAuthApi.resetPassword).toHaveBeenCalledWith({
      body: {
        newPassword: validInput.newPassword,
        token: validInput.token,
      },
    });
  });

  it('should return VALIDATION_ERROR for empty token', async () => {
    const result = await resetPassword(mockAuthApi, {
      token: '',
      newPassword: 'NewSecurePassword123!',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockAuthApi.resetPassword).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for password too short', async () => {
    const result = await resetPassword(mockAuthApi, {
      token: 'valid-token',
      newPassword: 'short',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockAuthApi.resetPassword).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for invalid/expired token error', async () => {
    vi.mocked(mockAuthApi.resetPassword).mockRejectedValueOnce(
      new Error('INVALID_TOKEN')
    );

    const result = await resetPassword(mockAuthApi, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(result.error.message).toContain('invalid or has expired');
    }
  });

  it('should return VALIDATION_ERROR for expired token error', async () => {
    vi.mocked(mockAuthApi.resetPassword).mockRejectedValueOnce(
      new Error('Token has expired')
    );

    const result = await resetPassword(mockAuthApi, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(result.error.message).toContain('invalid or has expired');
    }
  });

  it('should treat a Better Auth 4xx APIError as an invalid-token error', async () => {
    // Better Auth throws an APIError carrying a numeric statusCode + body.code
    // rather than a string the message-substring checks would catch.
    const apiError = Object.assign(new Error('Bad Request'), {
      statusCode: 400,
      status: 'BAD_REQUEST',
      body: { code: 'INVALID_TOKEN', message: 'Bad Request' },
    });
    vi.mocked(mockAuthApi.resetPassword).mockRejectedValueOnce(apiError);

    const result = await resetPassword(mockAuthApi, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(result.error.message).toContain('invalid or has expired');
    }
  });

  it('should match a capitalized "Invalid token" message', async () => {
    vi.mocked(mockAuthApi.resetPassword).mockRejectedValueOnce(
      new Error('Invalid token')
    );

    const result = await resetPassword(mockAuthApi, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('should return INTERNAL_ERROR for unexpected errors', async () => {
    vi.mocked(mockAuthApi.resetPassword).mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    const result = await resetPassword(mockAuthApi, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(result.error.message).toBe('Failed to reset password');
    }
  });
});
