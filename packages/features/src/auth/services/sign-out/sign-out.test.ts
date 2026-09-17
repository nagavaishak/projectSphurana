import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import type { SignOutAuthApi } from './sign-out.service.js';
import { signOut } from './sign-out.service.js';

// Helper to create a mock Response object
const createMockResponse = (ok: boolean, data: unknown = {}, status = 200) => ({
  ok,
  status,
  json: vi.fn().mockResolvedValue(data),
});

describe('signOut', () => {
  let mockAuthApi: SignOutAuthApi;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthApi = {
      signOut: vi.fn(),
    };
  });

  it('should sign out a user with valid session token', async () => {
    const input = {
      sessionToken: 'valid-session-token',
    };

    // Service expects Response with asResponse: true
    const mockResponse = createMockResponse(true, { success: true }, 200);

    vi.mocked(mockAuthApi.signOut).mockResolvedValueOnce(mockResponse as never);

    const result = await signOut(mockAuthApi, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
    }
    expect(mockAuthApi.signOut).toHaveBeenCalledWith({
      headers: {
        authorization: 'Bearer valid-session-token',
      },
      asResponse: true,
    });
  });

  it('should return validation error for empty session token', async () => {
    const input = {
      sessionToken: '',
    };

    const result = await signOut(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockAuthApi.signOut).not.toHaveBeenCalled();
  });

  it('should succeed even if session is already expired (401 response)', async () => {
    const input = {
      sessionToken: 'expired-session-token',
    };

    // Mock a 401 response (session expired)
    const mockResponse = createMockResponse(false, {}, 401);

    vi.mocked(mockAuthApi.signOut).mockResolvedValueOnce(mockResponse as never);

    const result = await signOut(mockAuthApi, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
    }
  });

  it('should succeed even if session throws error with "session" message', async () => {
    const input = {
      sessionToken: 'expired-session-token',
    };

    vi.mocked(mockAuthApi.signOut).mockRejectedValueOnce(
      new Error('session not found')
    );

    const result = await signOut(mockAuthApi, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
    }
  });

  it('should handle unexpected errors gracefully', async () => {
    const input = {
      sessionToken: 'valid-session-token',
    };

    vi.mocked(mockAuthApi.signOut).mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    const result = await signOut(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      // Service returns generic message, not the original error
      expect(result.error.message).toBe(
        'An error occurred while signing out. Please try again.'
      );
    }
  });
});
