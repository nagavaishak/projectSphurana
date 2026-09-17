import { logError, trackedResult } from '@borradh-workspace/observability';
import { ErrorCodes, FeatureError, err, ok } from '../../../shared/index.js';
import { buildSessionCookieHeaders } from '../../shared/session-headers.js';
import {
  type EnableTwoFactorInput,
  enableTwoFactorSchema,
} from './enable-two-factor.schema.js';

/**
 * Single client-facing failure message for this endpoint.
 *
 * Every failure mode — bad password, malformed input, Better Auth error —
 * collapses to this one 400 so the endpoint cannot be used to probe which of
 * those it was. Preserved verbatim from the controller implementation.
 */
const ENABLE_TWO_FACTOR_ERROR =
  'Failed to enable two-factor authentication. Check your password.';

export interface EnableTwoFactorResponse {
  totpURI: string;
  backupCodes: string[];
}

/**
 * Shape of `auth.api.enableTwoFactor`. Deliberately permissive (like the other
 * `*AuthApi` types in this package) so Better Auth's inferred API type stays
 * structurally assignable to it.
 */
export interface EnableTwoFactorAuthApi {
  enableTwoFactor: (options: {
    headers: Headers;
    body: { password: string };
    asResponse?: boolean;
  }) => Promise<unknown>;
}

const enableTwoFactorImpl = async (
  authApi: EnableTwoFactorAuthApi,
  input: EnableTwoFactorInput,
  sessionToken: string
) => {
  const parsed = enableTwoFactorSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, ENABLE_TWO_FACTOR_ERROR)
    );
  }

  try {
    const result = (await authApi.enableTwoFactor({
      headers: buildSessionCookieHeaders(sessionToken),
      body: { password: parsed.data.password },
    })) as { totpURI: string; backupCodes: string[] };

    return ok({
      totpURI: result.totpURI,
      backupCodes: result.backupCodes,
    } as EnableTwoFactorResponse);
  } catch (error) {
    // "Invalid password" is an expected user error — don't log to Sentry.
    const msg = error instanceof Error ? error.message : '';
    const isExpected =
      msg.includes('Invalid password') ||
      msg.includes('invalid password') ||
      msg.includes('INVALID_PASSWORD');
    if (!isExpected) {
      logError('auth.enableTwoFactor', error, { feature: 'auth' });
    }
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, ENABLE_TWO_FACTOR_ERROR)
    );
  }
};

/**
 * Begin TOTP enrolment for the session's user.
 *
 * @param authApi - Auth API instance (e.g. `auth.api` from Better Auth)
 * @param input - The user's current password (Better Auth re-verifies it)
 * @param sessionToken - Session token identifying the enrolling user
 */
export const enableTwoFactor = (
  authApi: EnableTwoFactorAuthApi,
  input: EnableTwoFactorInput,
  sessionToken: string
) =>
  trackedResult(
    'auth.enableTwoFactor',
    () => enableTwoFactorImpl(authApi, input, sessionToken),
    {
      properties: { hasSessionToken: !!sessionToken },
      internalErrorsOnly: true,
    }
  );

export type EnableTwoFactorResult = Awaited<ReturnType<typeof enableTwoFactor>>;
