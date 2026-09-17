import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import type { SignInAuthApi } from './sign-in.service.js';
import { signIn } from './sign-in.service.js';

// Helper to create a mock Response object
const createMockResponse = (
  ok: boolean,
  data: unknown,
  status = 200,
  setCookie?: string
) => ({
  ok,
  status,
  json: vi.fn().mockResolvedValue(data),
  headers: {
    get: vi.fn((name: string) => (name === 'set-cookie' ? setCookie : null)),
  },
});

describe('signIn', () => {
  let mockAuthApi: SignInAuthApi;

  beforeEach(() => {
    vi.clearAllMocks();
    // Use type assertion since we're mocking internal behavior
    mockAuthApi = {
      signInEmail: vi.fn(),
    } as unknown as SignInAuthApi;
  });

  it('should sign in a user with valid credentials', async () => {
    const input = {
      email: 'test@example.com',
      password: 'securepassword123',
    };

    const mockUser = {
      id: '123',
      email: input.email,
      name: 'Test User',
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Service expects Response with asResponse: true
    const mockResponse = createMockResponse(
      true,
      { user: mockUser, token: 'session-token' },
      200,
      'better-auth.session_token=session-token; Path=/; HttpOnly'
    );

    vi.mocked(mockAuthApi.signInEmail).mockResolvedValueOnce(
      mockResponse as never
    );

    const result = await signIn(mockAuthApi, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.user.email).toBe(input.email);
      expect(result.data.session.token).toBeDefined();
    }
    expect(mockAuthApi.signInEmail).toHaveBeenCalledWith({
      body: {
        email: input.email,
        password: input.password,
      },
      asResponse: true,
    });
  });

  it('should return validation error for invalid email', async () => {
    const input = {
      email: 'invalid-email',
      password: 'securepassword123',
    };

    const result = await signIn(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockAuthApi.signInEmail).not.toHaveBeenCalled();
  });

  it('should return validation error for empty password', async () => {
    const input = {
      email: 'test@example.com',
      password: '',
    };

    const result = await signIn(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockAuthApi.signInEmail).not.toHaveBeenCalled();
  });

  it('should return UNAUTHORIZED for invalid credentials (401 response)', async () => {
    const input = {
      email: 'test@example.com',
      password: 'wrongpassword',
    };

    // Mock a 401 response
    const mockResponse = createMockResponse(
      false,
      { message: 'Invalid credentials' },
      401
    );

    vi.mocked(mockAuthApi.signInEmail).mockResolvedValueOnce(
      mockResponse as never
    );

    const result = await signIn(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.UNAUTHORIZED);
      expect(result.error.message).toBe('Invalid email or password');
    }
  });

  it('should return UNAUTHORIZED when response has no user', async () => {
    const input = {
      email: 'test@example.com',
      password: 'wrongpassword',
    };

    // Mock a successful response but with null user
    const mockResponse = createMockResponse(
      true,
      { user: null, token: null },
      200
    );

    vi.mocked(mockAuthApi.signInEmail).mockResolvedValueOnce(
      mockResponse as never
    );

    const result = await signIn(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.UNAUTHORIZED);
      expect(result.error.message).toBe('Invalid email or password');
    }
  });

  it('should handle auth errors with Invalid message', async () => {
    const input = {
      email: 'test@example.com',
      password: 'wrongpassword',
    };

    vi.mocked(mockAuthApi.signInEmail).mockRejectedValueOnce(
      new Error('Invalid credentials')
    );

    const result = await signIn(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.UNAUTHORIZED);
    }
  });

  it('should handle unexpected errors gracefully', async () => {
    const input = {
      email: 'test@example.com',
      password: 'securepassword123',
    };

    vi.mocked(mockAuthApi.signInEmail).mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    const result = await signIn(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      // Service returns generic message, not the original error
      expect(result.error.message).toBe(
        'An error occurred while signing in. Please try again.'
      );
    }
  });
});
