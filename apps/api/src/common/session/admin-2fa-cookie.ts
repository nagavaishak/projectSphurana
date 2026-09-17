import { apiEnv } from '@borradh-workspace/env/api';
import type { Response } from 'express';
import {
  ADMIN_2FA_COOKIE,
  ADMIN_2FA_MAX_AGE,
} from '../guards/global-admin.guard.js';

/**
 * Issue the admin-terminal 2FA cookie that `GlobalAdminGuard` checks (and
 * refreshes) on every subsequent admin-terminal request.
 *
 * Attributes must stay identical to the guard's sliding-window refresh — a
 * mismatch would make the browser hold two cookies and the guard read the
 * stale one. Note there is deliberately NO explicit `path`: Express defaults it
 * to '/', which is what both this and the guard's refresh rely on.
 */
/**
 * Whether to mark the admin 2FA cookie `Secure`.
 *
 * `Secure` is right in every deployed environment and WRONG on a local http
 * stack: browsers silently DROP a Secure cookie served over http, so
 * `verify-2fa` returned 200, the cookie never landed, and every admin-terminal
 * request after it answered 401 — an admin terminal that showed zero
 * organizations and sent you back to the code prompt on every reload, with
 * nothing in the response naming a cookie.
 *
 * Keyed on NODE_ENV rather than on the request, so the two places that write
 * this cookie cannot disagree (see the attribute warning below).
 */
export const useSecureAdminCookie = (): boolean =>
  process.env.NODE_ENV === 'production';

export const setAdmin2faCookie = (res: Response, userId: string): void => {
  const cookieDomain = apiEnv.COOKIE_DOMAIN;

  res.cookie(ADMIN_2FA_COOKIE, `verified:${userId}:${Date.now()}`, {
    httpOnly: true,
    secure: useSecureAdminCookie(),
    sameSite: 'strict' as const,
    maxAge: ADMIN_2FA_MAX_AGE * 1000,
    ...(cookieDomain && { domain: cookieDomain }),
  });
};
