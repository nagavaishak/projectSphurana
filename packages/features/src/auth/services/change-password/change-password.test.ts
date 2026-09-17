import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import type { ChangePasswordAuthApi } from './change-password.service.js';
import { changePassword } from './change-password.service.js';

describe('changePassword', () => {
  let mockAuthApi: ChangePasswordAuthApi;
  const sessionToken = 'test-session-token';

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthApi = {
      changePassword: vi.fn(),
    } as unknown as ChangePasswordAuthApi;
  });

  const validInput = {
    currentPassword: 'OldPassword123!',
    newPassword: 'NewPassword456!',
    revokeOtherSessions: true,
  };

  it('should change password with valid input', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as Response;

    vi.mocked(mockAuthApi.changePassword).mockResolvedValueOnce(mockResponse);

    const result = await changePassword(mockAuthApi, validInput, sessionToken);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
      expect(result.data.message).toBe('Password changed successfully');
    }

    expect(mockAuthApi.changePassword).toHaveBeenCalledWith({
      body: {
        currentPassword: validInput.currentPassword,
        newPassword: validInput.newPassword,
        revokeOtherSessions: validInput.revokeOtherSessions,
      },
      headers: expect.any(Headers),
      asResponse: true,
    });
  });

  it('should return VALIDATION_ERROR for password without special character', async () => {
    const invalidInput = {
      currentPassword: 'OldPassword123!',
      newPassword: 'NewPassword456',
    };

    const result = await changePassword(
      mockAuthApi,
      invalidInput,
      sessionToken
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockAuthApi.changePassword).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing current password', async () => {
    const invalidInput = {
      currentPassword: '',
      newPassword: 'NewPassword456!',
    };

    const result = await changePassword(
      mockAuthApi,
      invalidInput,
      sessionToken
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockAuthApi.changePassword).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for password without uppercase', async () => {
    const invalidInput = {
      currentPassword: 'OldPassword123!',
      newPassword: 'newpassword456',
    };

    const result = await changePassword(
      mockAuthApi,
      invalidInput,
      sessionToken
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockAuthApi.changePassword).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for password without lowercase', async () => {
    const invalidInput = {
      currentPassword: 'OldPassword123!',
      newPassword: 'NEWPASSWORD456',
    };

    const result = await changePassword(
      mockAuthApi,
      invalidInput,
      sessionToken
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockAuthApi.changePassword).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for password without number', async () => {
    const invalidInput = {
      currentPassword: 'OldPassword123!',
      newPassword: 'NewPasswordABC',
    };

    const result = await changePassword(
      mockAuthApi,
      invalidInput,
      sessionToken
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockAuthApi.changePassword).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for password too short', async () => {
    const invalidInput = {
      currentPassword: 'OldPassword123!',
      newPassword: 'Short1',
    };

    const result = await changePassword(
      mockAuthApi,
      invalidInput,
      sessionToken
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockAuthApi.changePassword).not.toHaveBeenCalled();
  });

  it('should return UNAUTHORIZED for incorrect current password', async () => {
    const mockResponse = {
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({ message: 'Invalid password' }),
    } as unknown as Response;

    vi.mocked(mockAuthApi.changePassword).mockResolvedValueOnce(mockResponse);

    const result = await changePassword(mockAuthApi, validInput, sessionToken);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.UNAUTHORIZED);
      expect(result.error.message).toBe('Current password is incorrect');
    }
  });

  it('should return UNAUTHORIZED for 400 status with invalid message', async () => {
    const mockResponse = {
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({ message: 'Invalid credentials' }),
    } as unknown as Response;

    vi.mocked(mockAuthApi.changePassword).mockResolvedValueOnce(mockResponse);

    const result = await changePassword(mockAuthApi, validInput, sessionToken);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.UNAUTHORIZED);
    }
  });

  it('should return INTERNAL_ERROR for other API errors', async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({ message: 'Server error' }),
    } as unknown as Response;

    vi.mocked(mockAuthApi.changePassword).mockResolvedValueOnce(mockResponse);

    const result = await changePassword(mockAuthApi, validInput, sessionToken);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('should handle thrown errors with Invalid message', async () => {
    vi.mocked(mockAuthApi.changePassword).mockRejectedValueOnce(
      new Error('Invalid password')
    );

    const result = await changePassword(mockAuthApi, validInput, sessionToken);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.UNAUTHORIZED);
    }
  });

  it('should handle unexpected thrown errors', async () => {
    vi.mocked(mockAuthApi.changePassword).mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    const result = await changePassword(mockAuthApi, validInput, sessionToken);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('should use default value for revokeOtherSessions', async () => {
    const inputWithoutRevoke = {
      currentPassword: 'OldPassword123!',
      newPassword: 'NewPassword456!',
    };

    const mockResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as Response;

    vi.mocked(mockAuthApi.changePassword).mockResolvedValueOnce(mockResponse);

    const result = await changePassword(
      mockAuthApi,
      inputWithoutRevoke,
      sessionToken
    );

    expect(result.success).toBe(true);
    expect(mockAuthApi.changePassword).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          revokeOtherSessions: true, // default value
        }),
      })
    );
  });
});
