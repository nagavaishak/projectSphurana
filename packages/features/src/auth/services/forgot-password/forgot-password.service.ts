import { logError, trackedResult } from '@borradh-workspace/observability';
import { ErrorCodes, FeatureError, err, ok } from '../../../shared/index.js';
import {
  type ForgotPasswordInput,
  forgotPasswordSchema,
} from './forgot-password.schema.js';

export interface ForgotPasswordAuthApi {
  requestPasswordReset: (options: {
    body: { email: string; redirectTo?: string };
  }) => Promise<{ status: boolean }>;
}

export interface ForgotPasswordResponse {
  success: boolean;
}

const forgotPasswordImpl = async (
  authApi: ForgotPasswordAuthApi,
  input: ForgotPasswordInput
) => {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    await authApi.requestPasswordReset({
      body: {
        email: parsed.data.email,
        redirectTo: parsed.data.redirectTo,
      },
    });

    // Always return success to prevent email enumeration
    return ok({ success: true } as ForgotPasswordResponse);
  } catch (error) {
    logError('auth.forgotPassword', error, { feature: 'auth' });
    // Still return success to prevent email enumeration
    return ok({ success: true } as ForgotPasswordResponse);
  }
};

export const forgotPassword = (
  authApi: ForgotPasswordAuthApi,
  input: ForgotPasswordInput
) =>
  trackedResult(
    'auth.forgotPassword',
    () => forgotPasswordImpl(authApi, input),
    {
      properties: { email: input.email },
    }
  );

export type ForgotPasswordResult = Awaited<ReturnType<typeof forgotPassword>>;
