import { apiEnv } from '@borradh-workspace/env/api';
import type { Request, Response } from 'express';

/**
 * Patient-portal session-cookie TRANSPORT (ENG-647).
 *
 * A completely separate cookie from Better Auth's staff session — patients
 * are a second principal type with their own session store
 * (`patient_session`). Attributes mirror `session-cookie.ts` (the staff
 * cookie): always Secure (every environment is HTTPS, locally via the
 * cloudflared tunnel), SameSite 'lax' when COOKIE_DOMAIN is set (prod /
 * staging — SPA and API share the cookie cross-subdomain) and 'none' when it
 * isn't (per-PR previews on unrelated hostnames). Max-Age matches the 30-day
 * `patient_session.expires_at`.
 */

export const PATIENT_SESSION_COOKIE = 'borradh_patient_session';

const PATIENT_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Read the raw patient session token off a request, if present.
 *
 * `Authorization: Bearer <token>` wins over the cookie — local Vite and the
 * native app are cross-site to the API, so the httpOnly cookie doesn't flow
 * and those clients hold the token from the sign-in body instead (the exact
 * pattern staff auth uses via `X-Client-Type: mobile`, see
 * apps/app/src/lib/api-client.ts). Same-site deploys use the cookie.
 */
/**
 * Read the session token off an INCOMING request (bearer header or cookie).
 *
 * Renamed from `extractPatientSessionToken`, which collided with a differently
 * shaped export of the same name in `@borradh-workspace/auth/patient` — that
 * one parses a Set-Cookie header on the way OUT. Both are in scope in this
 * app, both handle the session credential, and picking the wrong one was a
 * type error rather than a silent bug only by luck.
 */
export const readPatientSessionTokenFromRequest = (
  req: Request
): string | undefined => {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    if (token) return token;
  }
  return req.cookies?.[PATIENT_SESSION_COOKIE];
};

export const setPatientSessionCookie = (res: Response, token: string): void => {
  const cookieDomain = apiEnv.COOKIE_DOMAIN;

  res.cookie(PATIENT_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: cookieDomain ? 'lax' : 'none',
    maxAge: PATIENT_SESSION_MAX_AGE_MS,
    path: '/',
    ...(cookieDomain && { domain: cookieDomain }),
  });
};

export const clearPatientSessionCookie = (res: Response): void => {
  const cookieDomain = apiEnv.COOKIE_DOMAIN;
  const baseCookieOptions = {
    httpOnly: true,
    secure: true,
    // Must match the SameSite used when setting — browsers ignore a clear
    // whose attributes differ from the original.
    sameSite: (cookieDomain ? 'lax' : 'none') as 'lax' | 'none',
    path: '/',
  };

  // With domain (properly configured cookies)…
  res.clearCookie(PATIENT_SESSION_COOKIE, {
    ...baseCookieOptions,
    ...(cookieDomain && { domain: cookieDomain }),
  });
  // …and without (stale cookies set directly on the api subdomain).
  res.clearCookie(PATIENT_SESSION_COOKIE, baseCookieOptions);
};
