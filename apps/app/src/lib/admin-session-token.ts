/**
 * Holds the `admin_session` cookie pair returned by
 * `POST /admin-terminal/impersonate` until the admin exits again.
 *
 * Better Auth reads that signed stash to find the admin to restore. Where the
 * browser stores no cookies — previews on unrelated hostnames, local dev, the
 * E2E runner — it never had one to send, so the API hands the pair back and we
 * return it on the way out. Otherwise the admin is stranded inside the
 * impersonated account with a "Back to admin panel" button that silently fails.
 *
 * WHY sessionStorage AND NOT A MODULE VARIABLE. Impersonating ends with
 * `window.location.href = ROUTES.dashboard` — a full page load, which wipes
 * in-memory state. The banner that needs this value runs on the OTHER side of
 * that reload, so an in-memory store is always empty by the time it is read.
 * (`two-factor-token.ts` can be in-memory because sign-in → verify-2fa is a
 * client-side route change with no reload.)
 *
 * sessionStorage is the right scope: it survives the reload, is confined to the
 * one tab doing the impersonating, and disappears when that tab closes. The
 * value is a credential, but one already delivered in a response body and only
 * useful for ending the impersonation it belongs to.
 */
const KEY = 'borradh.admin.sessionToken';

export function getAdminSessionToken(): string | undefined {
  try {
    return window.sessionStorage.getItem(KEY) ?? undefined;
  } catch {
    // Storage unavailable (private mode, blocked site data). The cookie path
    // still works wherever cookies are stored, which is every real deployment.
    return undefined;
  }
}

export function setAdminSessionToken(token: string | undefined): void {
  try {
    if (token) window.sessionStorage.setItem(KEY, token);
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // See above — nothing to do but carry on.
  }
}

export function clearAdminSessionToken(): void {
  setAdminSessionToken(undefined);
}
