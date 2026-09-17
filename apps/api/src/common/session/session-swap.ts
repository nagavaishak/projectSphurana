import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { forwardSetCookieHeaders } from './session-cookie.js';

/** What a Better Auth call that replaces the caller's session hands back. */
export interface SessionSwapResult {
  setCookieHeaders: string[];
  sessionToken?: string;
  /** Only impersonate produces this; stop-impersonating consumes it. */
  adminSessionCookie?: string;
  body: unknown;
}

/**
 * Send the response for a Better Auth call that REPLACED the caller's session
 * — impersonate and stop-impersonating.
 *
 * Both halves of the swap have to land or the caller's identity splits in two.
 * The cookie is only half: every client authenticates with a Bearer token
 * (`apps/app` sends `X-Client-Type: mobile` on web and native alike) and
 * `AuthGuard` prefers that Bearer over the cookie. Leave the Bearer behind and
 * our guards keep seeing the OLD user while Better Auth — which reads the
 * forwarded cookie — sees the new one, for the rest of the session.
 *
 * Sibling of `sendTwoFactorChallenge`: same shape, same reason for existing.
 */
export const sendSessionSwap = (
  res: Response,
  isMobile: boolean,
  result: SessionSwapResult
) => {
  // Carries the impersonated session cookie AND the `admin_session` cookie
  // that stop-impersonating later needs to get the admin back out.
  forwardSetCookieHeaders(res, result.setCookieHeaders);

  return res.status(HttpStatus.OK).json({
    ...(result.body as Record<string, unknown>),
    ...(isMobile && result.sessionToken && { token: result.sessionToken }),
    // The admin_session stash, for a client that cannot store the cookie. It
    // must send this back on stop-impersonating or it stays impersonated.
    ...(isMobile &&
      result.adminSessionCookie && {
        adminSessionToken: result.adminSessionCookie,
      }),
  });
};
