import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import type { SignUpAuthApi } from './sign-up.service.js';
import { signUp } from './sign-up.service.js';

// Helper to create a mock Response object
const createMockResponse = (ok: boolean, data: unknown, status = 200) => ({
  ok,
  status,
  json: vi.fn().mockResolvedValue(data),
  headers: {
    get: vi.fn().mockReturnValue(null),
  },
});

describe('signUp', () => {
  let mockAuthApi: SignUpAuthApi;

  beforeEach(() => {
    vi.clearAllMocks();
    // Use type assertion since we're mocking internal behavior
    mockAuthApi = {
      signUpEmail: vi.fn(),
    } as unknown as SignUpAuthApi;
  });

  it('should sign up a user with valid input', async () => {
    const input = {
      email: 'test@example.com',
      password: 'SecurePassword123!',
      name: 'Test User',
    };

    const mockUser = {
      id: '123',
      email: input.email,
      name: input.name,
      emailVerified: false,
      image: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Service expects Response with asResponse: true
    const mockResponse = createMockResponse(
      true,
      { user: mockUser, token: 'session-token' },
      200
    );

    vi.mocked(mockAuthApi.signUpEmail).mockResolvedValueOnce(
      mockResponse as never
    );

    const result = await signUp(mockAuthApi, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.user.email).toBe(input.email);
      expect(result.data.user.name).toBe(input.name);
      expect(result.data.session.token).toBeDefined();
    }
    expect(mockAuthApi.signUpEmail).toHaveBeenCalledWith({
      body: {
        email: input.email,
        password: input.password,
        name: input.name,
      },
      asResponse: true,
    });
  });

  it('should return validation error for invalid email', async () => {
    const input = {
      email: 'invalid-email',
      password: 'SecurePassword123!',
      name: 'Test User',
    };

    const result = await signUp(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockAuthApi.signUpEmail).not.toHaveBeenCalled();
  });

  it('should return validation error for short password', async () => {
    const input = {
      email: 'test@example.com',
      password: 'short',
      name: 'Test User',
    };

    const result = await signUp(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockAuthApi.signUpEmail).not.toHaveBeenCalled();
  });

  it('should return validation error for short name', async () => {
    const input = {
      email: 'test@example.com',
      password: 'SecurePassword123!',
      name: 'A',
    };

    const result = await signUp(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockAuthApi.signUpEmail).not.toHaveBeenCalled();
  });

  it('should return ALREADY_EXISTS when response has no user (409 response)', async () => {
    const input = {
      email: 'existing@example.com',
      password: 'SecurePassword123!',
      name: 'Test User',
    };

    // Mock a 409 Conflict response
    const mockResponse = createMockResponse(
      false,
      { message: 'User already exists' },
      409
    );

    vi.mocked(mockAuthApi.signUpEmail).mockResolvedValueOnce(
      mockResponse as never
    );

    const result = await signUp(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.ALREADY_EXISTS);
    }
  });

  it('should return ALREADY_EXISTS when response data is null', async () => {
    const input = {
      email: 'existing@example.com',
      password: 'SecurePassword123!',
      name: 'Test User',
    };

    // Mock successful response but with null user/token
    const mockResponse = createMockResponse(
      true,
      { user: null, token: null },
      200
    );

    vi.mocked(mockAuthApi.signUpEmail).mockResolvedValueOnce(
      mockResponse as never
    );

    const result = await signUp(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.ALREADY_EXISTS);
    }
  });

  // --- Bot-abuse email gate ---------------------------------------------
  // These prove that junk and disposable-domain emails are rejected BEFORE
  // account creation, so Better Auth's account-create + Resend verification
  // email are never reached. `signUpEmail` is the first downstream call and
  // the verification email fires only after it, so asserting it is NOT called
  // proves the email-send path is never invoked.
  it('rejects a disposable-domain email before account creation', async () => {
    const input = {
      email: 'bot@mailinator.com',
      password: 'SecurePassword123!',
      name: 'Bot User',
    };

    const result = await signUp(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    // Account creation (and therefore the Resend verification email) never runs.
    expect(mockAuthApi.signUpEmail).not.toHaveBeenCalled();
  });

  it('rejects a deliverability-hostile email (no TLD) that zod .email() lets through', async () => {
    const input = {
      // zod's permissive .email() accepts `foo@localhost`; Resend bounces it
      // with "Invalid `to` field". The gate must catch it first.
      email: 'foo@localhost',
      password: 'SecurePassword123!',
      name: 'Junk User',
    };

    const result = await signUp(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockAuthApi.signUpEmail).not.toHaveBeenCalled();
  });

  it('rejects an email with consecutive dots in the local part', async () => {
    const input = {
      email: 'a..b@example.com',
      password: 'SecurePassword123!',
      name: 'Junk User',
    };

    const result = await signUp(mockAuthApi, input);

    expect(result.success).toBe(false);
    expect(mockAuthApi.signUpEmail).not.toHaveBeenCalled();
  });

  it('allows a valid, non-disposable email through to account creation', async () => {
    const input = {
      email: 'real.person@gmail.com',
      password: 'SecurePassword123!',
      name: 'Real Person',
    };

    const mockUser = {
      id: '456',
      email: input.email,
      name: input.name,
      emailVerified: false,
      image: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const mockResponse = createMockResponse(
      true,
      { user: mockUser, token: 'session-token' },
      200
    );
    vi.mocked(mockAuthApi.signUpEmail).mockResolvedValueOnce(
      mockResponse as never
    );

    const result = await signUp(mockAuthApi, input);

    expect(result.success).toBe(true);
    // Legitimate signups still reach account creation / verification email.
    expect(mockAuthApi.signUpEmail).toHaveBeenCalledTimes(1);
  });

  it('should handle auth errors gracefully', async () => {
    const input = {
      email: 'test@example.com',
      password: 'SecurePassword123!',
      name: 'Test User',
    };

    vi.mocked(mockAuthApi.signUpEmail).mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    const result = await signUp(mockAuthApi, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      // Service returns generic message, not the original error
      expect(result.error.message).toBe(
        'An error occurred while creating your account. Please try again.'
      );
    }
  });
});
