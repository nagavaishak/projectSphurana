import { createLogger, trackedResult } from '@borradh-workspace/observability';
import {
  buildForwardedCookieHeaders,
  buildSessionCookiePair,
  extractSessionTokenFromSetCookies,
  readSetCookieHeaders,
} from '../../../auth/index.js';
import { ErrorCodes, FeatureError, err, ok } from '../../../shared/index.js';
import {
  type StopImpersonatingInput,
  stopImpersonatingSchema,
} from './stop-impersonating.schema.js';

const logger = createLogger('StopImpersonating');

const STOP_FAILED = 'Failed to stop impersonating';

export interface StopImpersonatingResponse {
  /**
   * Every Set-Cookie header Better Auth produced: the restored admin session
   * cookie plus the clearing of `admin_session`.
   */
  setCookieHeaders: string[];
  /**
   * The restored admin session's raw token, for Bearer clients — see the same
   * field on `ImpersonateUserResponse`. Without it the admin's cookie goes back
   * to the admin while their in-memory Bearer stays the impersonated user.
   */
  sessionToken?: string;
  /** Better Auth's JSON body, passed through to the client unchanged. */
  body: unknown;
}

export interface StopImpersonatingAuthApi {
  stopImpersonating: (options: {
    headers: Headers;
    asResponse?: boolean;
  }) => Promise<unknown>;
}

const stopImpersonatingImpl = async (
  authApi: StopImpersonatingAuthApi,
  input: StopImpersonatingInput
) => {
  const parsed = stopImpersonatingSchema.safeParse(input);
  if (!parsed.success) {
    // VALIDATION_ERROR is what the controller's error map turns into the 400
    // this endpoint has always returned for a refused restore.
    return err(new FeatureError(ErrorCodes.VALIDATION_ERROR, STOP_FAILED));
  }

  try {
    const response = (await authApi.stopImpersonating({
      headers: buildForwardedCookieHeaders(
        parsed.data.cookieHeader,
        parsed.data.sessionToken &&
          buildSessionCookiePair(parsed.data.sessionToken),
        parsed.data.adminSessionCookie
      ),
      asResponse: true,
    })) as globalThis.Response;

    if (!response.ok) {
      return err(new FeatureError(ErrorCodes.VALIDATION_ERROR, STOP_FAILED));
    }

    // Read Set-Cookie BEFORE consuming the body.
    const setCookieHeaders = readSetCookieHeaders(response);
    const body = await response.json().catch(() => ({}));

    return ok({
      setCookieHeaders,
      sessionToken: extractSessionTokenFromSetCookies(setCookieHeaders),
      body,
    } as StopImpersonatingResponse);
  } catch (error) {
    logger.error(
      `Stop impersonation error: ${error instanceof Error ? error.message : String(error)}`
    );
    return err(new FeatureError(ErrorCodes.INTERNAL_ERROR, STOP_FAILED));
  }
};

/**
 * Restore the original admin session, ending an impersonation.
 */
export const stopImpersonating = (
  authApi: StopImpersonatingAuthApi,
  input: StopImpersonatingInput
) =>
  trackedResult(
    'adminTerminal.stopImpersonating',
    () => stopImpersonatingImpl(authApi, input),
    { internalErrorsOnly: true }
  );

export type StopImpersonatingResult = Awaited<
  ReturnType<typeof stopImpersonating>
>;
