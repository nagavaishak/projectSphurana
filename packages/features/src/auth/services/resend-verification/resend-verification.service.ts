import { logError, trackedResult } from '@borradh-workspace/observability';
import { ErrorCodes, FeatureError, err, ok } from '../../../shared/index.js';
import {
  type ResendVerificationInput,
  resendVerificationSchema,
} from './resend-verification.schema.js';
import type {
  ResendVerificationAuthApi,
  ResendVerificationResponse,
} from './resend-verification.types.js';

// Re-export types for backward compatibility
export type {
  ResendVerificationResponse,
  ResendVerificationAuthApi,
} from './resend-verification.types.js';

/**
 * Internal implementation of resend-verification
 */
const resendVerificationImpl = async (
  authApi: ResendVerificationAuthApi,
  input: ResendVerificationInput
) => {
  // Validate input
  const parsed = resendVerificationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    // Use provided auth API to send verification email
    const response = await authApi.sendVerificationEmail({
      body: {
        email: parsed.data.email,
        callbackURL: parsed.data.callbackURL,
      },
      asResponse: true,
    });

    // Handle the Response object
    if (!response.ok) {
      // Don't reveal if email exists or not for security
      return ok({
        success: true,
        message:
          'If an account with that email exists and is unverified, a verification email has been sent.',
      } as ResendVerificationResponse);
    }

    const data = (await response.json()) as Record<string, unknown>;

    // Better Auth returns status: false if email not found or already verified
    if (!data || !data.status) {
      // Don't reveal if email exists or not for security
      return ok({
        success: true,
        message:
          'If an account with that email exists and is unverified, a verification email has been sent.',
      } as ResendVerificationResponse);
    }

    return ok({
      success: true,
      message: 'Verification email sent successfully.',
    } as ResendVerificationResponse);
  } catch (error) {
    logError('auth.resendVerification', error, {
      feature: 'auth',
      extra: { email: parsed.data.email },
    });
    // Don't expose internal error details to clients
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'An error occurred while sending the verification email. Please try again.',
        undefined,
        error instanceof Error ? error : undefined
      )
    );
  }
};

/**
 * Resend verification email to a user
 *
 * @param authApi - Auth API instance (e.g., auth.api from Better Auth)
 * @param input - Input with email and optional callback URL
 * @returns Result with success status or error
 *
 * @example
 * ```ts
 * import { auth } from '@borradh-workspace/auth/server';
 *
 * const result = await resendVerification(auth.api, {
 *   email: 'user@example.com',
 *   callbackURL: '/onboarding',
 * });
 *
 * if (result.success) {
 *   console.log('Email sent:', result.data.message);
 * } else {
 *   console.error('Error:', result.error.message);
 * }
 * ```
 */
export const resendVerification = (
  authApi: ResendVerificationAuthApi,
  input: ResendVerificationInput
) =>
  trackedResult(
    'auth.resendVerification',
    () => resendVerificationImpl(authApi, input),
    {
      properties: { email: input.email },
    }
  );

/**
 * Result type for resendVerification
 */
export type ResendVerificationResult = Awaited<
  ReturnType<typeof resendVerification>
>;
