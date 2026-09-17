import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import type { GetSessionAuthApi } from './get-session.service.js';
import { getSession } from './get-session.service.js';

// Helper to create a mock Response object
const createMockResponse = (ok: boolean, data: unknown, status = 200) => ({
  ok,
  status,
  json: vi.fn().mockResolvedValue(data),
});

describe('getSession', () => {
  let mockAuthApi: GetSessionAuthApi;

  beforeEach(() => {
    vi.clearAllMocks();
    // Use type assertion since we're mocking internal behavior
    mockAuthApi = {
      getSession: vi.fn(),
    } as unknown as GetSessionAuthApi;
  });

  it('should return session for valid token', async () => {
    const input = {
      sessionToken: 'valid-session-token',
    };

    const mockUser = {
      id: '123',
      email: 'test@example.com',
      name: 'Test User',
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockSession = {
      id: 'session-123',
      userId: mockUser.id,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
      token: 'valid-session-token',
    };

    // Service expects Response with asResponse: true
    const mockResponse = createMockResponse(
      true,
      { user: mockUser, session: mockSession },
      200
    );

    vi.mocked(mockAuthApi.getSession).mockResolvedValueOnce(
      mockResponse as never
    );

    const result = await getSession(mockAuthApi, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.user.email).toBe(mockUser.email);
      expect(result.data.session.id).toBe(mockSession.id);
    }
    // Service uses cookie header with Headers object
    expect(mockAuthApi.getSession).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.any(Headers),
        asResponse: true,
      })
    );
  });

  it('should return validation error for empty session token', async () => {
    const input = {
      sessionToken: '',
    };

    const result = await getSession(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockAuthApi.getSession).not.toHaveBeenCalled();
  });

  it('should return UNAUTHORIZED for invalid token (non-ok response)', async () => {
    const input = {
      sessionToken: 'invalid-token',
    };

    // Mock a 401 response
    const mockResponse = createMockResponse(false, {}, 401);

    vi.mocked(mockAuthApi.getSession).mockResolvedValueOnce(
      mockResponse as never
    );

    const result = await getSession(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.UNAUTHORIZED);
      expect(result.error.message).toBe('Invalid or expired session');
    }
  });

  it('should return UNAUTHORIZED for expired session', async () => {
    const input = {
      sessionToken: 'expired-token',
    };

    const mockUser = {
      id: '123',
      email: 'test@example.com',
      name: 'Test User',
      emailVerified: true,
    };

    // Session expired in the past
    const mockSession = {
      id: 'session-123',
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // expired yesterday
    };

    const mockResponse = createMockResponse(
      true,
      { user: mockUser, session: mockSession },
      200
    );

    vi.mocked(mockAuthApi.getSession).mockResolvedValueOnce(
      mockResponse as never
    );

    const result = await getSession(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.UNAUTHORIZED);
      expect(result.error.message).toBe('Session has expired');
    }
  });

  it('should return UNAUTHORIZED when user is null', async () => {
    const input = {
      sessionToken: 'valid-token',
    };

    // Mock successful response but with null user
    const mockResponse = createMockResponse(
      true,
      { user: null, session: null },
      200
    );

    vi.mocked(mockAuthApi.getSession).mockResolvedValueOnce(
      mockResponse as never
    );

    const result = await getSession(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.UNAUTHORIZED);
    }
  });

  it('should handle unexpected errors gracefully', async () => {
    const input = {
      sessionToken: 'valid-token',
    };

    vi.mocked(mockAuthApi.getSession).mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    const result = await getSession(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      // Service returns generic message, not the original error
      expect(result.error.message).toBe(
        'An error occurred while retrieving your session. Please try again.'
      );
    }
  });
});
