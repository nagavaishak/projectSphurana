import { apiEnv } from '@borradh-workspace/env/api';
import { Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Session-cookie TRANSPORT.
 *
 * Reading a cookie off a request is request shaping; writing or forwarding one
 * onto a response is response shaping. Neither is business logic, and both were
 * previously private helpers duplicated across `AuthController` and
 * `AdminTerminalController`. This module is the single implementation.
 *
 * Every attribute below is load-bearing: a drift in name, Domain, SameSite or
 * Path silently logs out every signed-in user, because the browser will not
 * overwrite or clear a cookie whose attribute set no longer matches.
 */

const logger = new Logger('SessionCookie');

/** The cookie name we always WRITE (Better Auth's secure-prefixed name). */
const SESSION_COOKIE = '__Secure-better-auth.session_token';

/** The unprefixed name, only ever read for diagnostics. */
const LEGACY_SESSION_COOKIE = 'better-auth.session_token';

/**
 * Resolve the caller's session token: `Authorization: Bearer` first (native
 * mobile), then the secure session cookie (web).
 */
export const extractSessionToken = (req: Request): string | undefined => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  const cookieNames = req.cookies ? Object.keys(req.cookies) : [];
  const secureToken = req.cookies?.[SESSION_COOKIE];
  const plainToken = req.cookies?.[LEGACY_SESSION_COOKIE];
  logger.log(
    `[SESSION-DEBUG] extractSessionToken: cookieNames=[${cookieNames.join(', ')}] hasSecureToken=${!!secureToken} hasPlainToken=${!!plainToken} COOKIE_DOMAIN=${apiEnv.COOKIE_DOMAIN || '(unset)'} NODE_ENV=${process.env.NODE_ENV}`
  );

  // Always the secure cookie name — all environments are HTTPS (locally via
  // the cloudflared tunnel).
  return secureToken;
};

/** True when the caller identified itself as the native mobile app. */
export const isMobileClient = (req: Request): boolean =>
  req.headers['x-client-type'] === 'mobile';

export const setSessionCookie = (res: Response, token: string): void => {
  const cookieDomain = apiEnv.COOKIE_DOMAIN; // e.g. '.example.com'

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true, // Always secure — every environment is HTTPS.
    // 'lax' when COOKIE_DOMAIN is set (prod, staging, cloudflared) so the SPA
    // and api can share the cookie cross-subdomain. 'none' when it's empty
    // (per-PR previews on unrelated *.vercel.app + *.fly.dev hostnames) so the
    // browser will send the cookie cross-site on the post-sign-in XHR.
    // Matches the conditional in packages/auth/src/server.ts.
    sameSite: cookieDomain ? 'lax' : 'none',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
    ...(cookieDomain && { domain: cookieDomain }),
  });
};

export const clearSessionCookie = (res: Response): void => {
  const cookieDomain = apiEnv.COOKIE_DOMAIN;
  const baseCookieOptions = {
    httpOnly: true,
    secure: true,
    // Must match the SameSite used when setting — browsers ignore a clear
    // whose attributes differ from the original.
    sameSite: (cookieDomain ? 'lax' : 'none') as 'lax' | 'none',
    path: '/',
  };
  const domainCookieOptions = {
    ...baseCookieOptions,
    ...(cookieDomain && { domain: cookieDomain }),
  };

  // With domain (properly configured cookies)…
  res.clearCookie(SESSION_COOKIE, domainCookieOptions);
  // …and without (stale cookies set directly on the api subdomain).
  res.clearCookie(SESSION_COOKIE, baseCookieOptions);
};

/** Pass Better Auth's own Set-Cookie headers straight through to the browser. */
export const forwardSetCookieHeaders = (
  res: Response,
  setCookieHeaders: string[] | undefined
): void => {
  for (const header of setCookieHeaders ?? []) {
    res.append('Set-Cookie', header);
  }
};

/**
 * Apply Better Auth's Set-Cookie headers after a successful TOTP verification.
 *
 * The session cookie is re-issued through `setSessionCookie` so it carries OUR
 * domain/SameSite/Max-Age; every other cookie (e.g. `trust_device`) is
 * forwarded verbatim.
 *
 * @returns the session token, if one was present.
 */
export const applySessionSetCookies = (
  res: Response,
  setCookieHeaders: string[]
): string | undefined => {
  const match = setCookieHeaders
    .join(', ')
    .match(/(?:__Secure-)?better-auth\.session_token=([^;]+)/);

  let sessionToken: string | undefined;
  if (match) {
    try {
      sessionToken = decodeURIComponent(match[1]);
    } catch {
      sessionToken = match[1];
    }
    setSessionCookie(res, sessionToken);
  }

  for (const header of setCookieHeaders) {
    // Skip the session token — set above with our own domain/options.
    if (header.includes('better-auth.session_token=')) continue;
    res.append('Set-Cookie', header);
  }

  return sessionToken;
};
