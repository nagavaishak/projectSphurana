import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import type { GoogleSignInAuthApi } from './google-sign-in.service.js';
import { googleSignIn } from './google-sign-in.service.js';

describe('googleSignIn', () => {
  let mockAuthApi: GoogleSignInAuthApi;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthApi = {
      signInSocial: vi.fn(),
    } as unknown as GoogleSignInAuthApi;
  });

  const validInput = {
    callbackURL: '/dashboard',
    errorCallbackURL: '/auth/error',
  };

  it('should return redirect URL from 302 response', async () => {
    const mockHeaders = new Headers();
    mockHeaders.set('location', 'https://accounts.google.com/oauth?state=abc');

    const mockResponse = {
      ok: false,
      status: 302,
      headers: mockHeaders,
    } as unknown as Response;

    vi.mocked(mockAuthApi.signInSocial).mockResolvedValueOnce(mockResponse);

    const result = await googleSignIn(mockAuthApi, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toBe(
        'https://accounts.google.com/oauth?state=abc'
      );
      expect(result.data.redirect).toBe(true);
    }

    expect(mockAuthApi.signInSocial).toHaveBeenCalledWith({
      body: {
        provider: 'google',
        callbackURL: validInput.callbackURL,
        errorCallbackURL: validInput.errorCallbackURL,
        newUserCallbackURL: undefined,
      },
      asResponse: true,
    });
  });

  it('should return redirect URL from response body', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: vi.fn().mockResolvedValue({
        url: 'https://accounts.google.com/oauth?state=xyz',
        redirect: true,
      }),
    } as unknown as Response;

    vi.mocked(mockAuthApi.signInSocial).mockResolvedValueOnce(mockResponse);

    const result = await googleSignIn(mockAuthApi, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toBe(
        'https://accounts.google.com/oauth?state=xyz'
      );
      expect(result.data.redirect).toBe(true);
    }
  });

  it('should use default callbackURL when not provided', async () => {
    const inputWithDefaults = {};

    const mockHeaders = new Headers();
    mockHeaders.set('location', 'https://accounts.google.com/oauth');

    const mockResponse = {
      ok: false,
      status: 302,
      headers: mockHeaders,
    } as unknown as Response;

    vi.mocked(mockAuthApi.signInSocial).mockResolvedValueOnce(mockResponse);

    const result = await googleSignIn(mockAuthApi, inputWithDefaults);

    expect(result.success).toBe(true);
    expect(mockAuthApi.signInSocial).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          callbackURL: '/dashboard', // default value
        }),
      })
    );
  });

  it('should pass newUserCallbackURL when provided', async () => {
    const inputWithNewUserCallback = {
      ...validInput,
      newUserCallbackURL: '/onboarding',
    };

    const mockHeaders = new Headers();
    mockHeaders.set('location', 'https://accounts.google.com/oauth');

    const mockResponse = {
      ok: false,
      status: 302,
      headers: mockHeaders,
    } as unknown as Response;

    vi.mocked(mockAuthApi.signInSocial).mockResolvedValueOnce(mockResponse);

    const result = await googleSignIn(mockAuthApi, inputWithNewUserCallback);

    expect(result.success).toBe(true);
    expect(mockAuthApi.signInSocial).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          newUserCallbackURL: '/onboarding',
        }),
      })
    );
  });

  it('should return INTERNAL_ERROR when response is not ok and no redirect URL', async () => {
    const mockResponse = {
      ok: false,
      status: 400,
      headers: new Headers(),
      json: vi.fn().mockResolvedValue({ message: 'OAuth provider error' }),
    } as unknown as Response;

    vi.mocked(mockAuthApi.signInSocial).mockResolvedValueOnce(mockResponse);

    const result = await googleSignIn(mockAuthApi, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(result.error.message).toBe('OAuth provider error');
    }
  });

  it('should return INTERNAL_ERROR when no redirect URL in response body', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: vi.fn().mockResolvedValue({}),
    } as unknown as Response;

    vi.mocked(mockAuthApi.signInSocial).mockResolvedValueOnce(mockResponse);

    const result = await googleSignIn(mockAuthApi, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(result.error.message).toBe(
        'No redirect URL received from OAuth provider'
      );
    }
  });

  it('should handle thrown errors', async () => {
    vi.mocked(mockAuthApi.signInSocial).mockRejectedValueOnce(
      new Error('Network error')
    );

    const result = await googleSignIn(mockAuthApi, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(result.error.message).toContain(
        'error occurred while initiating Google sign-in'
      );
    }
  });

  it('should default redirect to true when not in response', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: vi.fn().mockResolvedValue({
        url: 'https://accounts.google.com/oauth',
        // redirect not specified
      }),
    } as unknown as Response;

    vi.mocked(mockAuthApi.signInSocial).mockResolvedValueOnce(mockResponse);

    const result = await googleSignIn(mockAuthApi, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.redirect).toBe(true);
    }
  });
});
