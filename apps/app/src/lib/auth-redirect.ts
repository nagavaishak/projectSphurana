/**
 * Serialize the current in-app location for `?redirect=` (no origin).
 * Sign-in must receive a path like `/onboarding` — not a full URL — so
 * post-login navigation stays same-origin and matches TanStack `to` paths.
 */
export function authRedirectSearchValue(location: {
  href: string;
  pathname?: string;
  /** TanStack `ParsedLocation.search` is typed as an object; string form lives on `href`. */
  search?: string | Record<string, unknown>;
  hash?: string;
}): string {
  try {
    const u = new URL(location.href);
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    const pathname = location.pathname ?? '/';
    const search = typeof location.search === 'string' ? location.search : '';
    const hash = location.hash ?? '';
    return `${pathname}${search}${hash}`;
  }
}

/**
 * Normalize `?redirect=` / `?redirectTo=` into a safe in-app pathname.
 * Accepts `/dashboard/home`, full same-origin URLs, rejects external URLs.
 */
export function normalizePostAuthRedirect(
  raw: string | undefined,
  fallback: string
): string {
  if (!raw?.trim()) return fallback;
  const trimmed = raw.trim();
  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const u = new URL(trimmed);
      if (
        typeof window !== 'undefined' &&
        u.origin === window.location.origin
      ) {
        return `${u.pathname}${u.search}${u.hash}` || fallback;
      }
      return fallback;
    }
  } catch {
    return fallback;
  }
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed;
  }
  return fallback;
}
