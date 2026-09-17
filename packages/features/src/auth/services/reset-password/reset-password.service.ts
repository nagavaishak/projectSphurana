import { logError, trackedResult } from '@borradh-workspace/observability';
import { ErrorCodes, FeatureError, err, ok } from '../../../shared/index.js';
import {
  type ResetPasswordInput,
  resetPasswordSchema,
} from './reset-password.schema.js';

export interface ResetPasswordAuthApi {
  resetPassword: (options: {
    body: { newPassword: string; token: string };
  }) => Promise<{ status: boolean }>;
}

export interface ResetPasswordResponse {
  success: boolean;
}

const resetPasswordImpl = async (
  authApi: ResetPasswordAuthApi,
  input: ResetPasswordInput
) => {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    await authApi.resetPassword({
      body: {
        newPassword: parsed.data.newPassword,
        token: parsed.data.token,
      },
    });

    return ok({ success: true } as ResetPasswordResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const lower = message.toLowerCase();

    // Better Auth throws an APIError for client-side failures — most commonly
    // an invalid or expired reset token. The APIError carries a numeric
    // `statusCode` (4xx) and frequently a structured `body.code` such as
    // `INVALID_TOKEN`. Classify on those rather than only matching the
    // (case-sensitive, locale-dependent) message text, which let real
    // invalid-token failures slip through to a 500 + Sentry page.
    const statusCode = (error as { statusCode?: unknown })?.statusCode;
    const bodyCode = String(
      (error as { body?: { code?: unknown } })?.body?.code ?? ''
    ).toUpperCase();

    const isClientError =
      (typeof statusCode === 'number' &&
        statusCode >= 400 &&
        statusCode < 500) ||
      bodyCode.includes('TOKEN') ||
      lower.includes('invalid_token') ||
      lower.includes('expired') ||
      lower.includes('invalid');

    if (isClientError) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'Reset link is invalid or has expired. Please request a new one.'
        )
      );
    }

    logError('auth.resetPassword', error, { feature: 'auth' });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to reset password')
    );
  }
};

export const resetPassword = (
  authApi: ResetPasswordAuthApi,
  input: ResetPasswordInput
) =>
  trackedResult(
    'auth.resetPassword',
    () => resetPasswordImpl(authApi, input),
    { properties: {} } // Don't log token or password
  );

export type ResetPasswordResult = Awaited<ReturnType<typeof resetPassword>>;
