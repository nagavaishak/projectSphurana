import { createLogger, trackedResult } from '@borradh-workspace/observability';
import {
  buildForwardedCookieHeaders,
  buildSessionCookieHeaders,
  buildSessionCookiePair,
} from '../../../auth/index.js';
import {
  extractAdminSessionCookiePair,
  extractSessionTokenFromSetCookies,
  readSetCookieHeaders,
} from '../../../auth/index.js';
import { ErrorCodes, FeatureError, err, ok } from '../../../shared/index.js';
import {
  type ImpersonateUserInput,
  impersonateUserSchema,
} from './impersonate-user.schema.js';

const logger = createLogger('ImpersonateUser');

const IMPERSONATE_FAILED = 'Failed to impersonate user';

export interface ImpersonateUserResponse {
  /**
   * Every Set-Cookie header Better Auth produced — the impersonated session
   * cookie AND the `admin_session` cookie that `stopImpersonating` needs. All
   * of them must reach the browser or the admin cannot get back out.
   */
  setCookieHeaders: string[];
  /**
   * The impersonated session's raw token.
   *
   * Bearer clients (which is EVERY client — `apps/app` sends
   * `X-Client-Type: mobile` on web and native alike) authenticate from a token
   * they hold in memory, and `AuthGuard` prefers that Bearer over the cookie.
   * Without handing the new token back, the browser's cookie becomes the
   * impersonated user while the Bearer stays the admin, and the two identities
   * diverge for the rest of the session.
   */
  sessionToken?: string;
  /**
   * The `admin_session` cookie pair — the signed stash `stopImpersonating`
   * needs to find the admin to restore.
   *
   * Handed to bearer clients for the same reason as `sessionToken`: where the
   * browser stores no cookies, this one cannot be rebuilt from anything the
   * client holds, and without it an admin who impersonates has no way back.
   */
  adminSessionCookie?: string;
  /** Better Auth's JSON body, passed through to the client unchanged. */
  body: unknown;
}

export interface ImpersonateUserAuthApi {
  impersonateUser: (options: {
    headers: Headers;
    body: { userId: string };
    asResponse?: boolean;
  }) => Promise<unknown>;
  listOrganizations: (options: {
    headers: Headers;
    asResponse?: boolean;
  }) => Promise<unknown>;
  setActiveOrganization: (options: {
    headers: Headers;
    body: { organizationId: string };
    asResponse?: boolean;
  }) => Promise<unknown>;
}

/**
 * After impersonation, make the impersonated user's first organization active
 * so protected pages work immediately without a manual org selection.
 *
 * Non-critical: a failure here is logged and swallowed — impersonation itself
 * has already succeeded by this point.
 */
const autoSetActiveOrganization = async (
  authApi: ImpersonateUserAuthApi,
  sessionToken: string
): Promise<void> => {
  try {
    const listResponse = (await authApi.listOrganizations({
      headers: buildSessionCookieHeaders(sessionToken),
      asResponse: true,
    })) as globalThis.Response;

    if (!listResponse.ok) return;

    const orgs = (await listResponse.json()) as Array<{ id: string }>;
    if (!orgs.length) return;

    await authApi.setActiveOrganization({
      headers: buildSessionCookieHeaders(sessionToken),
      body: { organizationId: orgs[0].id },
      asResponse: true,
    });

    logger.info(
      `Auto-set active organization ${orgs[0].id} for impersonated session`
    );
  } catch (error) {
    logger.warn(
      `Failed to auto-set active organization: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

const impersonateUserImpl = async (
  authApi: ImpersonateUserAuthApi,
  input: ImpersonateUserInput
) => {
  const parsed = impersonateUserSchema.safeParse(input);
  if (!parsed.success) {
    return err(new FeatureError(ErrorCodes.FORBIDDEN, IMPERSONATE_FAILED));
  }

  try {
    const response = (await authApi.impersonateUser({
      headers: buildForwardedCookieHeaders(
        parsed.data.cookieHeader,
        parsed.data.sessionToken &&
          buildSessionCookiePair(parsed.data.sessionToken)
      ),
      body: { userId: parsed.data.userId },
      asResponse: true,
    })) as globalThis.Response;

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const message =
        (errorData as { message?: string }).message || IMPERSONATE_FAILED;
      return err(new FeatureError(ErrorCodes.FORBIDDEN, message));
    }

    // Read Set-Cookie BEFORE consuming the body.
    const setCookieHeaders = readSetCookieHeaders(response);

    const newToken = extractSessionTokenFromSetCookies(setCookieHeaders);
    if (newToken) {
      await autoSetActiveOrganization(authApi, newToken);
    }

    const body = await response.json().catch(() => ({}));

    return ok({
      setCookieHeaders,
      sessionToken: newToken,
      adminSessionCookie: extractAdminSessionCookiePair(setCookieHeaders),
      body,
    } as ImpersonateUserResponse);
  } catch (error) {
    logger.error(
      `Impersonation error: ${error instanceof Error ? error.message : String(error)}`
    );
    return err(new FeatureError(ErrorCodes.INTERNAL_ERROR, IMPERSONATE_FAILED));
  }
};

/**
 * Start impersonating a user. Better Auth mints a session as the target user
 * and stashes the admin's own session in a signed `admin_session` cookie.
 */
export const impersonateUser = (
  authApi: ImpersonateUserAuthApi,
  input: ImpersonateUserInput
) =>
  trackedResult(
    'adminTerminal.impersonateUser',
    () => impersonateUserImpl(authApi, input),
    { properties: { userId: input.userId } }
  );

export type ImpersonateUserResult = Awaited<ReturnType<typeof impersonateUser>>;
