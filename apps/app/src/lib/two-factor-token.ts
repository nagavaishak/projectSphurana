/**
 * In-memory store for the bearer `twoFactorToken` returned by `POST /auth/sign-in`
 * when 2FA is required (mobile/cross-origin clients). The token is the
 * `better-auth.two_factor=…` cookie pair as a raw string; we forward it back to
 * the server via the request body on `POST /auth/two-factor/verify-totp` so the
 * Cookie header survives the cross-origin round-trip.
 *
 * Cleared after a successful verification.
 */
let twoFactorToken: string | undefined;

export function getTwoFactorToken(): string | undefined {
  return twoFactorToken;
}

export function setTwoFactorToken(token: string | undefined): void {
  twoFactorToken = token;
}

export function clearTwoFactorToken(): void {
  twoFactorToken = undefined;
}
