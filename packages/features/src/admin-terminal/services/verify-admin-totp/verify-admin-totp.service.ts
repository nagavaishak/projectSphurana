import { createLogger, trackedResult } from '@borradh-workspace/observability';
import {
  buildForwardedCookieHeaders,
  buildSessionCookiePair,
} from '../../../auth/index.js';
import { ErrorCodes, FeatureError, err, ok } from '../../../shared/index.js';
import {
  type VerifyAdminTotpInput,
  verifyAdminTotpSchema,
} from './verify-admin-totp.schema.js';

const logger = createLogger('VerifyAdminTotp');

/** Single client-facing failure message, preserved verbatim from the controller. */
const INVALID_TOTP = 'Invalid TOTP code';

export interface VerifyAdminTotpResponse {
  verified: true;
}

export interface VerifyAdminTotpAuthApi {
  verifyTOTP: (options: {
    headers: Headers;
    body: { code: string };
    asResponse?: boolean;
  }) => Promise<unknown>;
}

const verifyAdminTotpImpl = async (
  authApi: VerifyAdminTotpAuthApi,
  input: VerifyAdminTotpInput
) => {
  const parsed = verifyAdminTotpSchema.safeParse(input);
  if (!parsed.success) {
    return err(new FeatureError(ErrorCodes.UNAUTHORIZED, INVALID_TOTP));
  }

  try {
    const response = await authApi.verifyTOTP({
      headers: buildForwardedCookieHeaders(
        parsed.data.cookieHeader,
        parsed.data.sessionToken &&
          buildSessionCookiePair(parsed.data.sessionToken)
      ),
      body: { code: parsed.data.code },
    });

    if (!response) {
      return err(new FeatureError(ErrorCodes.UNAUTHORIZED, INVALID_TOTP));
    }
  } catch (error) {
    logger.warn(
      `Admin 2FA verification failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return err(new FeatureError(ErrorCodes.UNAUTHORIZED, INVALID_TOTP));
  }

  return ok({ verified: true } as VerifyAdminTotpResponse);
};

/**
 * Verify an admin's TOTP code as the second factor for admin-terminal access.
 *
 * Separate from `auth.verifyTotp` because this flow always has a live session
 * (the admin is already signed in) and its only job is to gate the terminal.
 */
export const verifyAdminTotp = (
  authApi: VerifyAdminTotpAuthApi,
  input: VerifyAdminTotpInput
) =>
  trackedResult(
    'adminTerminal.verifyAdminTotp',
    () => verifyAdminTotpImpl(authApi, input),
    { internalErrorsOnly: true }
  );

export type VerifyAdminTotpResult = Awaited<ReturnType<typeof verifyAdminTotp>>;
