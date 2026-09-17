/**
 * Cookie rescoping for the same-origin API proxy (`src/pages/api/[...path].ts`).
 *
 * Better Auth issues sessions with `Domain=.borradh.io` in prod
 * (`packages/auth/src/patient.ts`, `crossSubDomainCookies`). A cookie whose
 * `Domain` does not domain-match the host serving the response is REJECTED
 * OUTRIGHT by the browser — so on a tenant domain the session silently never
 * sticks and every following request is anonymous.
 *
 * Verified in a real browser: with `Domain=.borradh.io` the cookie never
 * reached the API; with the attribute removed it did.
 *
 * Stripping the attribute yields a host-only cookie scoped to the tenant
 * domain, which is the scope we want anyway. This lives in the proxy rather
 * than in `packages/auth` so app.borradh.io and staging keep their existing
 * cross-subdomain behaviour: the proxy is the only component that knows the
 * public host, and it runs per-request where the Better Auth config is static.
 */
export function rescopeCookieForHost(setCookie: string, host: string): string {
  const match = /;\s*Domain=([^;]+)/i.exec(setCookie);
  if (!match) return setCookie;

  const domain = match[1].trim().replace(/^\./, '').toLowerCase();
  const hostname = host.split(':')[0].toLowerCase();

  // Suffix match must be on a LABEL boundary. A bare `endsWith(domain)` would
  // treat `notborradh.io` as matching `borradh.io` and leave a Domain the
  // browser then rejects — the exact bug this function exists to prevent.
  const domainMatches = hostname === domain || hostname.endsWith(`.${domain}`);
  if (domainMatches) return setCookie;

  return setCookie.replace(/;\s*Domain=[^;]+/i, '');
}
