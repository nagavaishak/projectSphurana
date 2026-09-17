/**
 * Build the outgoing `cookie` header for a server-to-server Better Auth call
 * that only needs to identify a session.
 *
 * Re-exported from `shared/session-cookie-name.ts`, which owns the single
 * definition of the cookie name. This module keeps the export so existing
 * `auth/shared` importers (AuthController, AdminTerminalController,
 * enable-two-factor, impersonate-user) do not have to move.
 */
export {
  buildSessionCookieHeaders,
  buildSessionCookiePair,
} from '../../shared/session-cookie-name.js';

/**
 * Build the outgoing `cookie` header from a raw inbound browser cookie header.
 *
 * Some Better Auth endpoints (verifyTOTP, impersonateUser, stopImpersonating)
 * read companion signed cookies — `two_factor`, `admin_session` — so the whole
 * header has to be forwarded, not just the session token.
 */
export const buildForwardedCookieHeaders = (
  cookieHeader: string | undefined,
  ...extraCookiePairs: (string | undefined)[]
): Headers => {
  const parts: string[] = [];
  if (cookieHeader) parts.push(cookieHeader);
  for (const pair of extraCookiePairs) {
    if (pair) parts.push(pair);
  }

  const headers = new Headers();
  if (parts.length > 0) {
    headers.set('cookie', parts.join('; '));
  }
  return headers;
};
