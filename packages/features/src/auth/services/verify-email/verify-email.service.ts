import { logError, trackedResult } from '@borradh-workspace/observability';
import { ErrorCodes, FeatureError, err, ok } from '../../../shared/index.js';
import {
  type VerifyEmailInput,
  verifyEmailSchema,
} from './verify-email.schema.js';
import type { VerifyEmailAuthApi } from './verify-email.types.js';

// Re-export types for backward compatibility
export type {
  VerifyEmailResponse,
  VerifyEmailAuthApi,
} from './verify-email.types.js';

/**
 * Internal implementation of verify-email
 */
const verifyEmailImpl = async (
  authApi: VerifyEmailAuthApi,
  input: VerifyEmailInput
) => {
  // Validate input
  const parsed = verifyEmailSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    // Use provided auth API to verify email with asResponse: true
    const response = await authApi.verifyEmail({
      query: {
        token: parsed.data.token,
      },
      asResponse: true,
    });

    // Check if the response was successful
    if (!response.ok) {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_INPUT,
          'Invalid or expired verification token'
        )
      );
    }

    // Extract session token from Set-Cookie header if present
    // When autoSignInAfterVerification is enabled, Better Auth sets a session cookie
    // In production, Better Auth prefixes cookies with '__Secure-'
    let sessionToken: string | undefined;
    const setCookieHeader = response.headers.get('set-cookie');
    if (setCookieHeader) {
      // Parse the session token - handle both prefixed and non-prefixed cookie names
      const sessionCookieMatch = setCookieHeader.match(
        /(?:__Secure-)?better-auth\.session_token=([^;]+)/
      );
      if (sessionCookieMatch) {
        // Decode URL-encoded characters in the token
        sessionToken = decodeURIComponent(sessionCookieMatch[1]);
      }
    }

    // Parse the JSON response
    const data = (await response.json()) as {
      user: {
        id: string;
        name: string;
        email: string;
        emailVerified: boolean;
      } | null;
      status: boolean;
    };

    // Better Auth returns status: false if token is invalid
    if (!data.status) {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_INPUT,
          'Invalid or expired verification token'
        )
      );
    }

    // Better Auth returns status: true when verification succeeds
    // User may be null - the database has already been updated
    // Session token is included when autoSignInAfterVerification is enabled
    return ok({
      user: data.user
        ? {
            id: data.user.id,
            email: data.user.email,
            name: data.user.name,
            emailVerified: data.user.emailVerified,
          }
        : null,
      sessionToken,
    });
  } catch (error) {
    // Log the actual error for debugging
    logError('auth.verifyEmail', error, {
      feature: 'auth',
      extra: {
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });

    // Don't expose internal error details to clients
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'An error occurred while verifying your email. Please try again.',
        undefined,
        error instanceof Error ? error : undefined
      )
    );
  }
};

/**
 * Verify a user's email address with a verification token
 *
 * @param authApi - Auth API instance (e.g., auth.api from Better Auth)
 * @param input - Verification input (token)
 * @returns Result with user data or error
 *
 * @example
 * ```ts
 * import { auth } from '@borradh-workspace/auth/server';
 *
 * const result = await verifyEmail(auth.api, {
 *   token: 'verification-token-from-email',
 * });
 *
 * if (result.success) {
 *   console.log('Email verified:', result.data.user);
 * } else {
 *   console.error('Error:', result.error.message);
 * }
 * ```
 */
export const verifyEmail = (
  authApi: VerifyEmailAuthApi,
  input: VerifyEmailInput
) =>
  trackedResult('auth.verifyEmail', () => verifyEmailImpl(authApi, input), {
    properties: {},
  });

/**
 * Result type for verifyEmail
 */
export type VerifyEmailResult = Awaited<ReturnType<typeof verifyEmail>>;
