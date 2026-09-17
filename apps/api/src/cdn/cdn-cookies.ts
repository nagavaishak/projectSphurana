import type { generateCdnSignedCookies } from '@borradh-workspace/features/cdn';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import { getCdnUrl } from '@borradh-workspace/storage';
import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

/**
 * CloudFront signed-cookie transport.
 *
 * Lifted out of `CdnController.getSignedCookies` (72 lines) and `.clearCookies`
 * (27), which were the two fattest handlers in the module. Nothing here is a
 * decision — it is the mechanical "put these three cookies on the response with
 * these attributes" step, which is exactly what a handler should be delegating.
 *
 * COOKIE ATTRIBUTES ARE A HARD CONTRACT. `Domain`, `Path`, `Secure`,
 * `HttpOnly`, `SameSite` and `Max-Age` must match between the set and the clear
 * call, and must match what CloudFront was handed at signing time — a single
 * character of drift and the browser either refuses to store the cookie or
 * refuses to send it back, and EVERY private media URL 403s. The option
 * objects below are byte-for-byte the ones the controller built; do not
 * "normalise" them.
 */

type SignedCookiesData = Extract<
  Awaited<ReturnType<typeof generateCdnSignedCookies>>,
  { success: true }
>['data'];

const CLOUDFRONT_COOKIES = [
  'CloudFront-Policy',
  'CloudFront-Signature',
  'CloudFront-Key-Pair-Id',
] as const;

export const isProductionHost = () => process.env.NODE_ENV === 'production';

/** No active org — a client problem, reported in the endpoint's own envelope. */
export function respondNoActiveOrganization(res: Response) {
  return res.status(HttpStatus.BAD_REQUEST).json({
    success: false,
    error: 'No active organization selected',
  });
}

/**
 * Render a signing failure into the endpoint's own envelope at `status`.
 *
 * The STATUS comes from the caller, not from here: `error-status-map` (the
 * one-code-one-status gate) parses `*.controller.ts` for the code→status
 * table, so `NOT_CONFIGURED → 503` has to stay declared on `CdnController`.
 * That 503 is load-bearing — the CDN being switched off on this deployment is
 * not a permission failure, and the client tells the two apart by the
 * `cdnUrl: null` field, which only appears on that branch.
 */
export function respondCdnCookieError(
  res: Response,
  error: { code: string; message: string },
  status: number
) {
  return res.status(status).json({
    success: false,
    error: error.message,
    ...(error.code === ErrorCodes.NOT_CONFIGURED ? { cdnUrl: null } : {}),
  });
}

/** Set all three CloudFront cookies and return the success envelope. */
export function respondWithCdnCookies(
  res: Response,
  data: SignedCookiesData,
  organizationId: string
) {
  const { cookies, domain, expiresIn, cdnUrl } = data;

  // Cookie options
  const cookieOptions = {
    httpOnly: true,
    secure: isProductionHost(),
    sameSite: 'strict' as const,
    maxAge: expiresIn * 1000,
    path: '/',
    ...(domain && { domain }),
  };

  for (const name of CLOUDFRONT_COOKIES) {
    res.cookie(name, cookies[name], cookieOptions);
  }

  return res.status(HttpStatus.OK).json({
    success: true,
    expiresIn,
    cdnUrl,
    organizationId,
  });
}

/**
 * Clear all three CloudFront cookies.
 *
 * The domain is recomputed here rather than reused from the set path because
 * clearing happens on requests that never signed anything. It must land on the
 * SAME domain the set path used (registrable domain of the CDN host, dot-
 * prefixed, production only) or the browser keeps the old cookies.
 */
export function respondClearingCdnCookies(res: Response) {
  const isProduction = isProductionHost();
  const cdnUrl = getCdnUrl();

  let cookieDomain: string | undefined;
  if (isProduction && cdnUrl) {
    const cdnHostname = new URL(cdnUrl).hostname;
    cookieDomain = `.${cdnHostname.split('.').slice(-2).join('.')}`;
  }

  const clearOptions = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict' as const,
    path: '/',
    ...(cookieDomain && { domain: cookieDomain }),
  };

  for (const name of CLOUDFRONT_COOKIES) {
    res.clearCookie(name, clearOptions);
  }

  return res.status(HttpStatus.OK).json({
    success: true,
    message: 'CDN cookies cleared',
  });
}
