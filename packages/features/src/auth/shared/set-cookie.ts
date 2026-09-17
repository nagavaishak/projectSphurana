/**
 * Read the individual `Set-Cookie` headers off a Better Auth `Response`.
 *
 * `getSetCookie()` is the correct API (it returns each cookie separately);
 * `get('set-cookie')` is the fallback for runtimes that lack it and can return
 * null even when `getSetCookie()` has entries, so it is only consulted second.
 */
export const readSetCookieHeaders = (
  response: globalThis.Response
): string[] => {
  const headersWithGetSetCookie = response.headers as {
    getSetCookie?: () => string[];
  };
  if (typeof headersWithGetSetCookie.getSetCookie === 'function') {
    return headersWithGetSetCookie.getSetCookie();
  }
  const raw = response.headers.get?.('set-cookie') ?? '';
  return raw ? [raw] : [];
};

/**
 * Pull the Better Auth session token value out of a list of Set-Cookie headers.
 *
 * Better Auth URL-encodes the token in the header; decoding here prevents the
 * value being encoded a second time when we re-issue our own cookie.
 */
export const extractSessionTokenFromSetCookies = (
  setCookieHeaders: string[]
): string | undefined => {
  const match = setCookieHeaders
    .join(', ')
    .match(/(?:__Secure-)?better-auth\.session_token=([^;]+)/);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};

/**
 * Pull Better Auth's `admin_session` cookie out of a Set-Cookie list as a raw
 * `name=value` pair.
 *
 * `stopImpersonating` reads this signed stash to find the admin to restore, and
 * it is the ONE piece of an impersonation that cannot be rebuilt from the
 * bearer — only Better Auth can mint it. Wherever the browser stores no cookies
 * (previews on unrelated hostnames, local dev, the E2E runner) an admin who
 * impersonates is otherwise stuck as that user with no way back.
 *
 * Same trade already made for `two_factor` on the sign-in path: hand the pair
 * to bearer clients so they can send it back on the request that needs it.
 */
export const extractAdminSessionCookiePair = (
  setCookieHeaders: string[]
): string | undefined => {
  for (const header of setCookieHeaders) {
    const match = header.match(
      /(__Secure-)?better-auth\.admin_session=([^;]+)/
    );
    if (match) {
      return `${match[1] ?? ''}better-auth.admin_session=${match[2]}`;
    }
  }
  return undefined;
};
