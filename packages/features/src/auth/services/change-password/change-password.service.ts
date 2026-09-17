import { logError, trackedResult } from '@borradh-workspace/observability';
import { ErrorCodes, FeatureError, err, ok } from '../../../shared/index.js';
import {
  type ChangePasswordInput,
  changePasswordSchema,
} from './change-password.schema.js';
import type {
  ChangePasswordAuthApi,
  ChangePasswordResponse,
} from './change-password.types.js';

// Re-export types for backward compatibility
export type {
  ChangePasswordResponse,
  ChangePasswordAuthApi,
} from './change-password.types.js';

/**
 * Internal implementation of change password
 */
const changePasswordImpl = async (
  authApi: ChangePasswordAuthApi,
  input: ChangePasswordInput,
  sessionToken: string
) => {
  // Validate input
  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    // Create headers with session token
    const headers = new Headers();
    headers.set('Cookie', `__Secure-better-auth.session_token=${sessionToken}`);

    // Use provided auth API to change password
    const response = (await authApi.changePassword({
      body: {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        revokeOtherSessions: parsed.data.revokeOtherSessions,
      },
      headers,
      asResponse: true,
    })) as Response;

    // Check if the response is ok
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage =
        (errorData as { message?: string })?.message ||
        'Failed to change password';

      // Check for specific error cases
      if (
        response.status === 401 ||
        response.status === 400 ||
        errorMessage.toLowerCase().includes('invalid') ||
        errorMessage.toLowerCase().includes('incorrect')
      ) {
        return err(
          new FeatureError(
            ErrorCodes.UNAUTHORIZED,
            'Current password is incorrect'
          )
        );
      }

      return err(new FeatureError(ErrorCodes.INTERNAL_ERROR, errorMessage));
    }

    return ok({
      success: true,
      message: 'Password changed successfully',
    } as ChangePasswordResponse);
  } catch (error) {
    // Better Auth throws on invalid credentials
    if (
      error instanceof Error &&
      (error.message.includes('Invalid') || error.message.includes('incorrect'))
    ) {
      return err(
        new FeatureError(
          ErrorCodes.UNAUTHORIZED,
          'Current password is incorrect'
        )
      );
    }

    // Don't expose internal error details to clients
    logError('auth.changePassword', error, { feature: 'auth' });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'An error occurred while changing password. Please try again.',
        undefined,
        error instanceof Error ? error : undefined
      )
    );
  }
};

/**
 * Change a user's password
 *
 * @param authApi - Auth API instance (e.g., auth.api from Better Auth)
 * @param input - Change password input (currentPassword, newPassword, revokeOtherSessions)
 * @param sessionToken - Session token for authentication
 * @returns Result with success status or error
 *
 * @example
 * ```ts
 * import { auth } from '@borradh-workspace/auth/server';
 *
 * const result = await changePassword(
 *   auth.api,
 *   {
 *     currentPassword: 'oldpassword123',
 *     newPassword: 'newpassword456',
 *     revokeOtherSessions: true,
 *   },
 *   sessionToken
 * );
 *
 * if (result.success) {
 *   console.log('Password changed successfully');
 * } else {
 *   console.error('Error:', result.error.message);
 * }
 * ```
 */
export const changePassword = (
  authApi: ChangePasswordAuthApi,
  input: ChangePasswordInput,
  sessionToken: string
) =>
  trackedResult(
    'auth.changePassword',
    () => changePasswordImpl(authApi, input, sessionToken),
    {
      properties: { hasSessionToken: !!sessionToken },
    }
  );

/**
 * Result type for changePassword
 */
export type ChangePasswordResult = Awaited<ReturnType<typeof changePassword>>;
