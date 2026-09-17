import { logError, trackedResult } from '@borradh-workspace/observability';
import { ErrorCodes, FeatureError, err, ok } from '../../../shared/index.js';
import {
  type GoogleSignInInput,
  googleSignInSchema,
} from './google-sign-in.schema.js';
import type {
  GoogleSignInAuthApi,
  GoogleSignInResponse,
} from './google-sign-in.types.js';

// Re-export types for backward compatibility
export type {
  GoogleSignInResponse,
  GoogleSignInAuthApi,
} from './google-sign-in.types.js';

/**
 * Internal implementation of Google sign-in
 */
const googleSignInImpl = async (
  authApi: GoogleSignInAuthApi,
  input: GoogleSignInInput
) => {
  // Validate input
  const parsed = googleSignInSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    const response = await authApi.signInSocial({
      body: {
        provider: 'google',
        callbackURL: parsed.data.callbackURL,
        errorCallbackURL: parsed.data.errorCallbackURL,
        newUserCallbackURL: parsed.data.newUserCallbackURL,
      },
      asResponse: true,
    });

    // Check for redirect response (302)
    if (response.status === 302) {
      const redirectUrl = response.headers.get('location');
      if (redirectUrl) {
        return ok({
          url: redirectUrl,
          redirect: true,
        } as GoogleSignInResponse);
      }
    }

    // Check if response is ok
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage =
        (errorData as { message?: string })?.message || 'Google sign-in failed';

      return err(new FeatureError(ErrorCodes.INTERNAL_ERROR, errorMessage));
    }

    // Parse response body for redirect URL
    const data = await response.json();
    const responseData = data as { url?: string; redirect?: boolean };

    if (responseData.url) {
      return ok({
        url: responseData.url,
        redirect: responseData.redirect ?? true,
      } as GoogleSignInResponse);
    }

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'No redirect URL received from OAuth provider'
      )
    );
  } catch (error) {
    logError('auth.googleSignIn', error, { feature: 'auth' });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'An error occurred while initiating Google sign-in. Please try again.',
        undefined,
        error instanceof Error ? error : undefined
      )
    );
  }
};

/**
 * Initiate Google OAuth sign-in flow
 *
 * @param authApi - Auth API instance (e.g., auth.api from Better Auth)
 * @param input - Google sign-in input (callbackURL, errorCallbackURL, newUserCallbackURL)
 * @returns Result with redirect URL or error
 *
 * @example
 * ```ts
 * import { auth } from '@borradh-workspace/auth/server';
 *
 * const result = await googleSignIn(auth.api, {
 *   callbackURL: '/dashboard',
 *   errorCallbackURL: '/auth/error',
 * });
 *
 * if (result.success) {
 *   // Redirect user to result.data.url
 *   res.redirect(result.data.url);
 * } else {
 *   console.error('Error:', result.error.message);
 * }
 * ```
 */
export const googleSignIn = (
  authApi: GoogleSignInAuthApi,
  input: GoogleSignInInput
) =>
  trackedResult('auth.googleSignIn', () => googleSignInImpl(authApi, input), {
    properties: { callbackURL: input.callbackURL },
  });

/**
 * Result type for googleSignIn
 */
export type GoogleSignInResult = Awaited<ReturnType<typeof googleSignIn>>;
