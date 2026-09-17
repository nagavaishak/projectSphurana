/**
 * The outcome of a provider OAuth callback, expressed as a SITE-RELATIVE path.
 *
 * Why a path and not a URL: the web origin (`APP_URL`/`WEB_URL`) is transport
 * configuration and belongs to the API app, not to a use case. The use case
 * decides *where the user should end up* — which genuinely is product behaviour,
 * and differs per provider (Stripe's onboarding flow returns to `/onboarding`,
 * Meta Ads to `/connect/meta-ads`, everything else to the integrations page) —
 * and `OAuthRedirectInterceptor` turns that into an absolute redirect.
 *
 * The consequence worth having: a callback handler becomes one line with no
 * `@Res()`, so it cannot accidentally grow URL-building logic again.
 */

/** Marks a use-case return value as "send the browser here". */
export const OAUTH_REDIRECT = Symbol.for('borradh.oauthRedirect');

export interface OAuthRedirectResult {
  readonly [OAUTH_REDIRECT]: true;
  /**
   * Site-relative (starts with `/`) unless `external` is set, in which case it
   * is an absolute provider URL.
   */
  readonly path: string;
  /**
   * Set for the OUTBOUND leg — the redirect to the provider's own consent
   * screen. Those URLs are absolute and must NOT be prefixed with our web
   * origin, which is the one way this abstraction could produce a broken
   * redirect silently.
   */
  readonly external?: true;
}

export function isOAuthRedirect(value: unknown): value is OAuthRedirectResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[OAUTH_REDIRECT] === true
  );
}

/** Send the browser to a provider's absolute authorize URL. */
export function externalRedirect(url: string): OAuthRedirectResult {
  return { [OAUTH_REDIRECT]: true, path: url, external: true };
}

/**
 * Build a redirect outcome. `params` with `undefined` values are dropped, so
 * callers can pass optional fields without composing the query string by hand —
 * which is where the pre-existing handlers kept getting `?`-vs-`&` wrong.
 */
export function oauthRedirect(
  path: string,
  params: Record<string, string | undefined> = {}
): OAuthRedirectResult {
  const entries = Object.entries(params).filter(
    (e): e is [string, string] => e[1] !== undefined
  );
  if (entries.length === 0) return { [OAUTH_REDIRECT]: true, path };

  const search = new URLSearchParams(entries).toString();
  const separator = path.includes('?') ? '&' : '?';
  return { [OAUTH_REDIRECT]: true, path: `${path}${separator}${search}` };
}
