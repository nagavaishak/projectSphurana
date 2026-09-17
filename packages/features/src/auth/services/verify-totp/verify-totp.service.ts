import { createLogger, trackedResult } from '@borradh-workspace/observability';
import { ErrorCodes, FeatureError, err, ok } from '../../../shared/index.js';
import { buildForwardedCookieHeaders } from '../../shared/session-headers.js';
import { readSetCookieHeaders } from '../../shared/set-cookie.js';
import {
  type VerifyTotpInput,
  verifyTotpSchema,
} from './verify-totp.schema.js';

const logger = createLogger('VerifyTotp');

/**
 * Single client-facing failure message. Every failure mode collapses to this
 * one 401 so the endpoint cannot be used to distinguish "wrong code" from
 * "no two_factor cookie". Preserved verbatim from the controller.
 */
const INVALID_CODE = 'Invalid verification code';

export interface VerifyTotpResponse {
  /**
   * Raw Set-Cookie headers from Better Auth: the new session cookie plus any
   * companion cookies (e.g. `trust_device`). The transport layer decides which
   * to re-issue and which to forward as-is.
   */
  setCookieHeaders: string[];
  /** Present in the sign-in 2FA flow, absent in the settings verify flow. */
  user?: { id: string };
  /** Body-carried session token, used as a fallback for bearer clients. */
  token?: string;
}

/**
 * Shape of `auth.api.verifyTOTP`. Deliberately permissive (like the other
 * `*AuthApi` types in this package) so Better Auth's inferred API type stays
 * structurally assignable to it; the call site passes `asResponse: true`.
 */
export interface VerifyTotpAuthApi {
  verifyTOTP: (options: {
    headers: Headers;
    body: { code: string; trustDevice?: boolean };
    asResponse?: boolean;
  }) => Promise<unknown>;
}

const verifyTotpImpl = async (
  authApi: VerifyTotpAuthApi,
  input: VerifyTotpInput
) => {
  const parsed = verifyTotpSchema.safeParse(input);
  if (!parsed.success) {
    return err(new FeatureError(ErrorCodes.UNAUTHORIZED, INVALID_CODE));
  }

  const headers = buildForwardedCookieHeaders(
    parsed.data.cookieHeader,
    parsed.data.twoFactorToken
  );

  try {
    const response = (await authApi.verifyTOTP({
      headers,
      body: { code: parsed.data.code, trustDevice: parsed.data.trustDevice },
      asResponse: true,
    })) as globalThis.Response;

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logger.warn(`TOTP verification failed: ${JSON.stringify(errorData)}`);
      return err(new FeatureError(ErrorCodes.UNAUTHORIZED, INVALID_CODE));
    }

    // Read Set-Cookie BEFORE consuming the body — the body read is what makes
    // the response unusable, and the headers are what carry the new session.
    const setCookieHeaders = readSetCookieHeaders(response);

    const responseData = (await response.json().catch(() => ({}))) as {
      user?: { id: string };
      token?: string;
    };

    return ok({
      setCookieHeaders,
      user: responseData.user,
      token: responseData.token,
    } as VerifyTotpResponse);
  } catch (error) {
    logger.warn(
      `TOTP verification failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return err(new FeatureError(ErrorCodes.UNAUTHORIZED, INVALID_CODE));
  }
};

/**
 * Verify a TOTP code against Better Auth.
 *
 * Serves both the sign-in 2FA challenge and the settings-page verification;
 * which one is running is decided entirely by the cookie that comes in.
 */
export const verifyTotp = (
  authApi: VerifyTotpAuthApi,
  input: VerifyTotpInput
) =>
  trackedResult('auth.verifyTotp', () => verifyTotpImpl(authApi, input), {
    properties: { trustDevice: !!input.trustDevice },
    internalErrorsOnly: true,
  });

export type VerifyTotpResult = Awaited<ReturnType<typeof verifyTotp>>;
