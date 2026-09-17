import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import type { AppleNativeSignInAuthApi } from './apple-native-sign-in.service.js';
import { appleNativeSignIn } from './apple-native-sign-in.service.js';

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

describe('appleNativeSignIn', () => {
  let mockAuthApi: AppleNativeSignInAuthApi;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthApi = {
      signInSocial: vi.fn(),
    } as unknown as AppleNativeSignInAuthApi;
  });

  it('should sign in with a valid Apple identity token', async () => {
    const input = {
      identityToken: 'valid-apple-identity-token',
      fullName: { givenName: 'John', familyName: 'Doe' },
    };

    const mockUser = {
      id: 'user-123',
      email: 'john@apple.com',
      name: 'John Doe',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockResponse = createMockResponse(
      true,
      { user: mockUser, token: 'session-token-123' },
      200,
      'better-auth.session_token=session-token-123; Path=/; HttpOnly'
    );

    vi.mocked(mockAuthApi.signInSocial).mockResolvedValueOnce(
      mockResponse as never
    );

    const result = await appleNativeSignIn(mockAuthApi, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.user.email).toBe('john@apple.com');
      expect(result.data.session.token).toBeDefined();
    }
    expect(mockAuthApi.signInSocial).toHaveBeenCalledWith({
      body: {
        provider: 'apple',
        idToken: { token: input.identityToken },
      },
      asResponse: true,
    });
  });

  it('should use fullName when user.name is empty (first sign-in)', async () => {
    const input = {
      identityToken: 'valid-token',
      fullName: { givenName: 'Jane', familyName: 'Smith' },
    };

    const mockResponse = createMockResponse(
      true,
      {
        user: {
          id: 'user-456',
          email: 'jane@apple.com',
          name: '',
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        token: 'tok',
      },
      200,
      'better-auth.session_token=tok; Path=/'
    );

    vi.mocked(mockAuthApi.signInSocial).mockResolvedValueOnce(
      mockResponse as never
    );

    const result = await appleNativeSignIn(mockAuthApi, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.user.name).toBe('Jane Smith');
    }
  });

  it('should return VALIDATION_ERROR for empty identity token', async () => {
    const result = await appleNativeSignIn(mockAuthApi, {
      identityToken: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockAuthApi.signInSocial).not.toHaveBeenCalled();
  });

  it('should return UNAUTHORIZED for 401 response', async () => {
    const mockResponse = createMockResponse(
      false,
      { message: 'Invalid token' },
      401
    );

    vi.mocked(mockAuthApi.signInSocial).mockResolvedValueOnce(
      mockResponse as never
    );

    const result = await appleNativeSignIn(mockAuthApi, {
      identityToken: 'invalid-token',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.UNAUTHORIZED);
    }
  });

  it('should return UNAUTHORIZED when response has no user', async () => {
    const mockResponse = createMockResponse(
      true,
      { user: null, token: 'tok' },
      200,
      'better-auth.session_token=tok; Path=/'
    );

    vi.mocked(mockAuthApi.signInSocial).mockResolvedValueOnce(
      mockResponse as never
    );

    const result = await appleNativeSignIn(mockAuthApi, {
      identityToken: 'some-token',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.UNAUTHORIZED);
    }
  });

  it('should return INTERNAL_ERROR on unexpected exceptions', async () => {
    vi.mocked(mockAuthApi.signInSocial).mockRejectedValueOnce(
      new Error('Network failure')
    );

    const result = await appleNativeSignIn(mockAuthApi, {
      identityToken: 'valid-token',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
