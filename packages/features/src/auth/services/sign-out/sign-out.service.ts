import { logError, trackedResult } from '@borradh-workspace/observability';
import { ErrorCodes, FeatureError, err, ok } from '../../../shared/index.js';
import { type SignOutInput, signOutSchema } from './sign-out.schema.js';
import type { SignOutAuthApi, SignOutResponse } from './sign-out.types.js';

// Re-export types for backward compatibility
export type { SignOutResponse, SignOutAuthApi } from './sign-out.types.js';

/**
 * Internal implementation of sign-out
 */
const signOutImpl = async (authApi: SignOutAuthApi, input: SignOutInput) => {
  // Validate input
  const parsed = signOutSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    // Use provided auth API to revoke session
    const response = await authApi.signOut({
      headers: {
        authorization: `Bearer ${parsed.data.sessionToken}`,
      },
      asResponse: true,
    });

    if (!response.ok) {
      // Session might already be expired/invalid (401), still consider it a success
      if (response.status === 401) {
        return ok({ success: true } as SignOutResponse);
      }

      const errorData = (await response.json().catch(() => ({}))) as {
        message?: string;
      };
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          errorData.message ||
            'An error occurred while signing out. Please try again.'
        )
      );
    }

    return ok({ success: true } as SignOutResponse);
  } catch (error) {
    // Session might already be expired/invalid, still consider it a success
    if (error instanceof Error && error.message.includes('session')) {
      return ok({ success: true } as SignOutResponse);
    }

    // Don't expose internal error details to clients
    logError('auth.signOut', error, { feature: 'auth' });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'An error occurred while signing out. Please try again.',
        undefined,
        error instanceof Error ? error : undefined
      )
    );
  }
};

/**
 * Sign out a user and invalidate their session
 *
 * @param authApi - Auth API instance (e.g., auth.api from Better Auth)
 * @param input - Sign-out input (sessionToken)
 * @returns Result with success status or error
 *
 * @example
 * ```ts
 * import { auth } from '@borradh-workspace/auth/server';
 *
 * const result = await signOut(auth.api, {
 *   sessionToken: 'session-token-here',
 * });
 *
 * if (result.success) {
 *   console.log('User signed out successfully');
 * } else {
 *   console.error('Error:', result.error.message);
 * }
 * ```
 */
export const signOut = (authApi: SignOutAuthApi, input: SignOutInput) =>
  trackedResult('auth.signOut', () => signOutImpl(authApi, input), {
    properties: { hasSessionToken: !!input.sessionToken },
  });

/**
 * Result type for signOut
 */
export type SignOutResult = Awaited<ReturnType<typeof signOut>>;
