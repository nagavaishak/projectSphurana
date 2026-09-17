/**
 * The ONE name every server-to-server Better Auth call must use for the
 * session cookie.
 *
 * Better Auth derives the `__Secure-` prefix from `advanced.useSecureCookies`,
 * and `packages/auth/src/server.ts` pins that to `true` in every environment —
 * matching the hardcoded `secure: true` that
 * `apps/api/src/common/session/session-cookie.ts` writes the real cookie with.
 * So the name is a constant, not a decision.
 *
 * It used to be re-derived at five separate call sites as
 * `NODE_ENV === 'production' || Boolean(COOKIE_DOMAIN)`. That expression is
 * false in exactly one place — local dev on http://localhost with no tunnel —
 * which is the configuration `scripts/local-stack.mjs` creates. It broke
 * `getSession` outright there (sign-in succeeded, the next request was
 * anonymous, and the cookie was cleared). The organization/2FA endpoints
 * happened to survive it only because Better Auth's session lookup on those
 * routes accepts either name; that is an implementation detail of the library,
 * not a guarantee, and it is not worth depending on.
 */
export const SESSION_COOKIE_NAME = '__Secure-better-auth.session_token';

/**
 * Build the outgoing `cookie` header for a Better Auth call that only needs to
 * identify a session.
 *
 * The token is URL-encoded so its special characters (`+`, `/`, `=`) survive
 * the cookie header.
 */
export const buildSessionCookieHeaders = (sessionToken: string): Headers => {
  const headers = new Headers();
  headers.set(
    'cookie',
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`
  );
  return headers;
};

/**
 * The session cookie as a raw `name=value` pair, for APPENDING to a forwarded
 * browser cookie header.
 *
 * Better Auth resolves the session from the cookie header it is handed. Our
 * clients authenticate with a Bearer token, and wherever the browser has not
 * stored a session cookie — per-PR previews on unrelated hostnames, local dev,
 * the E2E runner — forwarding the browser's header alone hands Better Auth
 * nothing to resolve. It then falls through to the `two_factor` cookie branch
 * and fails with "Invalid two factor cookie", which the admin gate reports as
 * "Invalid TOTP code".
 *
 * Appending the token the request actually authenticated with closes that gap
 * WITHOUT discarding the companion cookies (`two_factor`, `admin_session`)
 * those same endpoints still need.
 */
export const buildSessionCookiePair = (sessionToken: string): string =>
  `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`;
