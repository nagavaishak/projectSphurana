import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { forwardSetCookieHeaders } from './session-cookie.js';

/**
 * Extract Better Auth's `two_factor` cookie as a raw `name=value` pair from a
 * list of Set-Cookie headers.
 *
 * Bearer/cross-origin clients (Capacitor mobile) cannot accept the cross-site
 * cookie, so they get this string in the sign-in response body and pass it back
 * as `twoFactorToken` on verify-totp.
 */
export const extractTwoFactorCookiePair = (
  setCookieHeaders: string[]
): string | undefined => {
  for (const header of setCookieHeaders) {
    const match = header.match(/(__Secure-)?better-auth\.two_factor=([^;]+)/);
    if (match) {
      return `${match[1] ?? ''}better-auth.two_factor=${match[2]}`;
    }
  }
  return undefined;
};

/**
 * Send the "2FA required" response for a sign-in that stopped at the second
 * factor: forward Better Auth's signed `two_factor` cookie to the browser, and
 * hand mobile clients the raw pair because they cannot receive that cookie.
 */
export const sendTwoFactorChallenge = (
  res: Response,
  setCookieHeaders: string[] | undefined,
  isMobile: boolean
) => {
  forwardSetCookieHeaders(res, setCookieHeaders);

  const twoFactorToken =
    isMobile && setCookieHeaders
      ? extractTwoFactorCookiePair(setCookieHeaders)
      : undefined;

  return res.status(HttpStatus.OK).json({
    twoFactorRequired: true,
    ...(twoFactorToken && { twoFactorToken }),
  });
};
