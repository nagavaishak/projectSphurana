import { logError, trackedResult } from '@borradh-workspace/observability';
import { ErrorCodes, FeatureError, err, ok } from '../../../shared/index.js';
import {
  clearFailedAttempts,
  isAccountLocked,
  recordFailedAttempt,
} from './login-attempt-tracker.js';
import { type SignInInput, signInSchema } from './sign-in.schema.js';
import type { SignInAuthApi, SignInResponse } from './sign-in.types.js';

// Re-export types for backward compatibility
export type { SignInResponse, SignInAuthApi } from './sign-in.types.js';

/**
 * Internal implementation of sign-in
 */
const signInImpl = async (authApi: SignInAuthApi, input: SignInInput) => {
  // Validate input
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Check if account is locked due to too many failed attempts
  const lockStatus = await isAccountLocked(parsed.data.email);
  if (lockStatus.locked) {
    return err(
      new FeatureError(
        ErrorCodes.FORBIDDEN,
        `Account temporarily locked due to too many failed attempts. Try again in ${lockStatus.minutesRemaining} minutes.`
      )
    );
  }

  try {
    // Use provided auth API to authenticate
    const response = await authApi.signInEmail({
      body: {
        email: parsed.data.email,
        password: parsed.data.password,
      },
      asResponse: true,
    });

    // Check if the response is ok
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage =
        (errorData as { message?: string })?.message || 'Sign in failed';

      if (
        response.status === 401 ||
        errorMessage.toLowerCase().includes('invalid')
      ) {
        await recordFailedAttempt(parsed.data.email);
        return err(
          new FeatureError(ErrorCodes.UNAUTHORIZED, 'Invalid email or password')
        );
      }

      return err(new FeatureError(ErrorCodes.INTERNAL_ERROR, errorMessage));
    }

    const rawData = await response.json();

    // Better Auth's 2FA after-hook returns 200 with { twoFactorRedirect: true }
    // and sets a signed two_factor cookie via Set-Cookie header
    const typedData = rawData as { twoFactorRedirect?: boolean };
    if (typedData.twoFactorRedirect) {
      // Extract Set-Cookie headers so the controller can forward them to the browser.
      // The two_factor cookie is required for the subsequent verify-totp call.
      // Use getSetCookie() first (returns individual cookies correctly),
      // then fall back to get('set-cookie'). These can return different results —
      // get('set-cookie') may return null even when getSetCookie() has entries.
      let setCookieHeaders: string[] = [];
      const headersWithGetSetCookie = response.headers as {
        getSetCookie?: () => string[];
      };
      if (typeof headersWithGetSetCookie.getSetCookie === 'function') {
        setCookieHeaders = headersWithGetSetCookie.getSetCookie();
      } else {
        const rawSetCookie = response.headers.get('set-cookie');
        if (rawSetCookie) {
          setCookieHeaders = [rawSetCookie];
        }
      }
      return ok({
        twoFactorRequired: true,
        setCookieHeaders,
      } as SignInResponse);
    }

    // Extract session token from set-cookie header
    // Better Auth sets the session in a cookie, not just in the response body
    const setCookieHeader = response.headers.get('set-cookie');
    let sessionToken = '';

    if (setCookieHeader) {
      // Parse the better-auth.session_token from the set-cookie header
      // Better Auth may use __Secure- prefix when crossSubDomainCookies is enabled
      // Format: [__Secure-]better-auth.session_token=TOKEN; Path=/; ...
      const cookieMatch = setCookieHeader.match(
        /(?:__Secure-)?better-auth\.session_token=([^;]+)/
      );
      if (cookieMatch) {
        const rawToken = cookieMatch[1];

        // Decode the token - Better Auth URL-encodes the token in Set-Cookie header
        // If we don't decode it here, Express will encode it again when we set our cookie,
        // causing double-encoding (e.g., %2B becomes %252B)
        try {
          sessionToken = decodeURIComponent(rawToken);
        } catch {
          // If decoding fails, use the raw value
          sessionToken = rawToken;
        }
      }
    }

    const data = rawData as {
      user: {
        id: string;
        email: string;
        name: string;
        emailVerified: boolean;
        createdAt: Date;
        updatedAt: Date;
      };
      token: string;
    };

    // Better Auth returns { token, user, redirect } not { session, user }
    if (!data.user) {
      await recordFailedAttempt(parsed.data.email);
      return err(
        new FeatureError(ErrorCodes.UNAUTHORIZED, 'Invalid email or password')
      );
    }

    // Use the session token from cookies if available, otherwise fall back to body token
    const tokenToUse = sessionToken || data.token;

    if (!tokenToUse) {
      return err(
        new FeatureError(ErrorCodes.UNAUTHORIZED, 'No session token received')
      );
    }

    await clearFailedAttempts(parsed.data.email);

    return ok({
      user: {
        id: data.user.id,
        email: data.user.email,
        name: data.user.name,
        emailVerified: data.user.emailVerified,
        createdAt: data.user.createdAt,
        updatedAt: data.user.updatedAt,
      },
      session: {
        token: tokenToUse,
      },
    } as SignInResponse);
  } catch (error) {
    // Better Auth throws on invalid credentials
    if (error instanceof Error && error.message.includes('Invalid')) {
      await recordFailedAttempt(parsed.data.email);
      return err(
        new FeatureError(ErrorCodes.UNAUTHORIZED, 'Invalid email or password')
      );
    }

    // Don't expose internal error details to clients
    logError('auth.signIn', error, { feature: 'auth' });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'An error occurred while signing in. Please try again.',
        undefined,
        error instanceof Error ? error : undefined
      )
    );
  }
};

/**
 * Authenticate a user with email and password
 *
 * @param authApi - Auth API instance (e.g., auth.api from Better Auth)
 * @param input - Sign-in input (email, password)
 * @returns Result with user and session or error
 *
 * @example
 * ```ts
 * import { auth } from '@borradh-workspace/auth/server';
 *
 * const result = await signIn(auth.api, {
 *   email: 'user@example.com',
 *   password: 'securepassword123',
 * });
 *
 * if (result.success) {
 *   console.log('User signed in:', result.data.user);
 *   console.log('Session:', result.data.session);
 * } else {
 *   console.error('Error:', result.error.message);
 * }
 * ```
 */
export const signIn = (authApi: SignInAuthApi, input: SignInInput) =>
  trackedResult('auth.signIn', () => signInImpl(authApi, input), {
    properties: { email: input.email },
    // Failed sign-ins (bad password, lockout) are expected conditions,
    // not errors worth tracking as such.
    internalErrorsOnly: true,
  });

/**
 * Result type for signIn
 */
export type SignInResult = Awaited<ReturnType<typeof signIn>>;
