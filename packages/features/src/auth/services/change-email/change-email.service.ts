import { logError, trackedResult } from '@borradh-workspace/observability';
import { ErrorCodes, FeatureError, err, ok } from '../../../shared/index.js';
import {
  type ChangeEmailInput,
  changeEmailSchema,
} from './change-email.schema.js';
import type {
  ChangeEmailAuthApi,
  ChangeEmailResponse,
} from './change-email.types.js';

// Re-export types for backward compatibility
export type {
  ChangeEmailResponse,
  ChangeEmailAuthApi,
} from './change-email.types.js';

/**
 * Internal implementation of change email
 */
const changeEmailImpl = async (
  authApi: ChangeEmailAuthApi,
  input: ChangeEmailInput,
  sessionToken: string
) => {
  // Validate input
  const parsed = changeEmailSchema.safeParse(input);
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

    // Use provided auth API to change email
    const response = (await authApi.changeEmail({
      body: {
        newEmail: parsed.data.newEmail,
        callbackURL: parsed.data.callbackURL,
      },
      headers,
      asResponse: true,
    })) as Response;

    // Check if the response is ok
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage =
        (errorData as { message?: string })?.message ||
        'Failed to change email';

      if (response.status === 401) {
        return err(new FeatureError(ErrorCodes.UNAUTHORIZED, 'Unauthorized'));
      }

      if (
        response.status === 400 ||
        errorMessage.toLowerCase().includes('already')
      ) {
        return err(new FeatureError(ErrorCodes.ALREADY_EXISTS, errorMessage));
      }

      return err(new FeatureError(ErrorCodes.INTERNAL_ERROR, errorMessage));
    }

    return ok({
      success: true,
      message: 'Verification email sent to new address',
    } as ChangeEmailResponse);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes('already')
    ) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          'Email address is already in use'
        )
      );
    }

    logError('auth.changeEmail', error, { feature: 'auth' });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'An error occurred while changing email. Please try again.',
        undefined,
        error instanceof Error ? error : undefined
      )
    );
  }
};

/**
 * Change a user's email address
 *
 * Sends a verification email to the new address. The email is only
 * updated after the user verifies the new address.
 *
 * @param authApi - Auth API instance (e.g., auth.api from Better Auth)
 * @param input - Change email input (newEmail, callbackURL?)
 * @param sessionToken - Session token for authentication
 * @returns Result with success status or error
 */
export const changeEmail = (
  authApi: ChangeEmailAuthApi,
  input: ChangeEmailInput,
  sessionToken: string
) =>
  trackedResult(
    'auth.changeEmail',
    () => changeEmailImpl(authApi, input, sessionToken),
    {
      properties: { newEmail: input.newEmail },
    }
  );

/**
 * Result type for changeEmail
 */
export type ChangeEmailResult = Awaited<ReturnType<typeof changeEmail>>;
