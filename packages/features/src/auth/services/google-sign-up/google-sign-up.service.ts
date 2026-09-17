import { logError, trackedResult } from '@borradh-workspace/observability';
import { ErrorCodes, FeatureError, err, ok } from '../../../shared/index.js';
import {
  type GoogleSignUpInput,
  googleSignUpSchema,
} from './google-sign-up.schema.js';
import type {
  GoogleSignUpAuthApi,
  GoogleSignUpResponse,
} from './google-sign-up.types.js';

// Re-export types for backward compatibility
export type {
  GoogleSignUpResponse,
  GoogleSignUpAuthApi,
} from './google-sign-up.types.js';

/**
 * Internal implementation of Google sign-up
 */
const googleSignUpImpl = async (
  authApi: GoogleSignUpAuthApi,
  input: GoogleSignUpInput
) => {
  // Validate input
  const parsed = googleSignUpSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    // For sign-up, we use newUserCallbackURL to redirect new users to onboarding
    const response = await authApi.signInSocial({
      body: {
        provider: 'google',
        callbackURL: parsed.data.callbackURL,
        errorCallbackURL: parsed.data.errorCallbackURL,
        newUserCallbackURL: parsed.data.callbackURL, // New users go to onboarding
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
        } as GoogleSignUpResponse);
      }
    }

    // Check if response is ok
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage =
        (errorData as { message?: string })?.message || 'Google sign-up failed';

      return err(new FeatureError(ErrorCodes.INTERNAL_ERROR, errorMessage));
    }

    // Parse response body for redirect URL
    const data = await response.json();
    const responseData = data as { url?: string; redirect?: boolean };

    if (responseData.url) {
      return ok({
        url: responseData.url,
        redirect: responseData.redirect ?? true,
      } as GoogleSignUpResponse);
    }

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'No redirect URL received from OAuth provider'
      )
    );
  } catch (error) {
    logError('auth.googleSignUp', error, { feature: 'auth' });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'An error occurred while initiating Google sign-up. Please try again.',
        undefined,
        error instanceof Error ? error : undefined
      )
    );
  }
};

/**
 * Initiate Google OAuth sign-up flow
 *
 * @param authApi - Auth API instance (e.g., auth.api from Better Auth)
 * @param input - Google sign-up input (callbackURL, errorCallbackURL)
 * @returns Result with redirect URL or error
 */
export const googleSignUp = (
  authApi: GoogleSignUpAuthApi,
  input: GoogleSignUpInput
) =>
  trackedResult('auth.googleSignUp', () => googleSignUpImpl(authApi, input), {
    properties: { callbackURL: input.callbackURL },
  });

/**
 * Result type for googleSignUp
 */
export type GoogleSignUpResult = Awaited<ReturnType<typeof googleSignUp>>;
