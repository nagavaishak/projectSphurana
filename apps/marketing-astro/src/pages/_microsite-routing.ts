/**
 * WHICH MICROSITE IS THIS HOST — decided once, in middleware, for every request.
 *
 * Three tiers serve the same microsite (plan §9, Phase 4 contract §3):
 *
 *   salon.com/about            custom   → the HOST names the site
 *   acme.borradh.io/about      wildcard → the HOST names the site
 *   www.borradh.io/sites/acme  path     → the PATH names the site
 *
 * Only the path tier had routes. This module is what makes the other two serve
 * the SAME routes: a tenant-host request is REWRITTEN internally onto
 * `/sites/{slug}/…` so one set of pages renders all three tiers and they cannot
 * drift. The rewrite is internal — the visitor's URL never gains a `/sites/`
 * prefix.
 *
 * A REWRITE, NEVER A REDIRECT. Contract §3 is explicit: an unknown host is a
 * 404. A redirect to our apex turns one misconfigured DNS record into a
 * redirect loop, which reads as a total outage and is far harder to diagnose
 * than a 404 on one hostname.
 *
 * Underscore-prefixed, so Astro does not route it. Same convention as
 * `book/_resolve-org.ts`.
 */

/** Identifiers only — this mirrors the API's `resolveMicrositeHost` response, which is a pre-auth surface. */
export interface ResolvedMicrositeHost {
  micrositeId: string;
  organizationId: string;
  slug: string;
  status: 'draft' | 'published';
  tier: 'custom' | 'wildcard' | 'path';
}

declare global {
  namespace App {
    interface Locals {
      /**
       * Set by the middleware when the request arrived on a tenant host, so a
       * page does not resolve the host a SECOND time. Absent on the path tier
       * and on marketing routes.
       */
      microsite?: ResolvedMicrositeHost;
    }
  }
}

/**
 * The apexes we own. Same variable name the API reads, so the two sides cannot
 * disagree about what a wildcard host is.
 */
const baseDomains = (): string[] =>
  (process.env.MICROSITE_BASE_DOMAIN ?? 'borradh.io,borradh-dev.com')
    .split(',')
    .map((d) =>
      d
        .trim()
        .toLowerCase()
        .replace(/^\.+|\.+$/g, '')
    )
    .filter(Boolean);

/**
 * Hosts that are OURS but are not a tenant: local dev and the deploy platform's
 * generated domains. Without this every preview deployment and every `localhost`
 * request would be classified as a custom domain and 404 the entire marketing
 * site.
 */
const isInfrastructureHost = (host: string): boolean =>
  host === 'localhost' ||
  host === '127.0.0.1' ||
  host === '::1' ||
  host.endsWith('.local') ||
  host.endsWith('.vercel.app') ||
  host.endsWith('.fly.dev');

/** Lowercase, no port, no trailing dot. */
export const normalizeHost = (raw: string): string =>
  raw.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.+$/, '');

export type HostKind =
  | { kind: 'platform' }
  | { kind: 'tenant'; tier: 'custom' | 'wildcard' };

/**
 * Is this request on a tenant host?
 *
 * `platform` covers the marketing apex, `www`, nested platform subdomains
 * (`app.daniel.borradh-dev.com`), localhost and preview domains — everything
 * that must keep serving marketing pages untouched.
 */
export const classifyHost = (rawHost: string): HostKind => {
  const host = normalizeHost(rawHost);
  if (!host || isInfrastructureHost(host)) return { kind: 'platform' };

  for (const apex of baseDomains()) {
    if (host === apex || host === `www.${apex}`) return { kind: 'platform' };
    if (host.endsWith(`.${apex}`)) {
      const label = host.slice(0, host.length - apex.length - 1);
      // A SINGLE label is a tenant. `a.b.borradh.io` is not — treating it as
      // one would let anyone who can create a CNAME claim a slug.
      return label && !label.includes('.')
        ? { kind: 'tenant', tier: 'wildcard' }
        : { kind: 'platform' };
    }
  }

  return { kind: 'tenant', tier: 'custom' };
};

/**
 * Paths that are never microsite content, on any host.
 *
 * `/book/*` and `/venue/*` are on this list DELIBERATELY. Both are routes of
 * this app that carry the org slug in their own URL, so they work unchanged on
 * a tenant host — and rewriting them would produce `/sites/{slug}/book/{slug}`,
 * which is not a route, 404ing the primary conversion target.
 *
 * `/book/*` is now the LEGACY shape (booking lives under the microsite base);
 * it stays here because the redirect that rescues old links is itself served
 * from `/book/`, and a rewritten path would never reach it.
 *
 * The asset and proxy prefixes matter for the 404 case too: an unknown host must
 * still be able to serve the stylesheet of the page it is being shown.
 */
const SKIPPED_PREFIXES = [
  '/_', // /_astro, /_image, /_actions, /_server-islands
  '/api/',
  '/r3y/',
  '/dashboard/',
  '/debug/',
  '/monitoring',
  '/accept-invitation',
  '/book/',
  '/venue/',
  '/sites/', // already the path tier
  '/.well-known/',
];

export const isSkippedPath = (pathname: string): boolean => {
  const path = pathname.toLowerCase();
  if (SKIPPED_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  // A file request (favicon.ico, robots.txt, sitemap.xml, og-image.png).
  return /\.[a-z0-9]{2,5}$/.test(path);
};

/** `/about` on `salon.com` → `/sites/acme/about`, query string preserved. */
export const micrositeRewritePath = (
  slug: string,
  pathname: string,
  search = ''
): string => {
  const suffix = pathname === '/' ? '' : pathname.replace(/\/+$/, '');
  return `/sites/${encodeURIComponent(slug)}${suffix}${search}`;
};

export type MicrositeRoute =
  /** Not a microsite request — render whatever the router already had. */
  | { kind: 'passthrough' }
  /** Serve this microsite by rewriting onto the path-tier routes. */
  | { kind: 'rewrite'; path: string; site: ResolvedMicrositeHost }
  /** The host resolves to nothing. 404 — never a redirect. */
  | { kind: 'not-found' }
  /** We could not ask. A real tenant host must not 404 because the API blinked. */
  | { kind: 'unavailable' };

/** A hung API must not hold the request open; mirrors the microsite page's own budget. */
const RESOLVE_TIMEOUT_MS = 4000;

/**
 * Resolve the host through the API — which answers from Redis
 * (`microsite:host:{host}`, contract §3), so the common case is one cache hit
 * and no query. The slug is NEVER guessed from the hostname: a wrong guess
 * would show one clinic's customer another clinic's site and portal.
 */
export const decideMicrositeRoute = async (
  {
    host,
    pathname,
    search,
  }: { host: string; pathname: string; search?: string },
  deps: { apiUrl: string; fetch?: typeof fetch }
): Promise<MicrositeRoute> => {
  if (isSkippedPath(pathname)) return { kind: 'passthrough' };
  if (classifyHost(host).kind !== 'tenant') return { kind: 'passthrough' };

  const apiUrl = deps.apiUrl.replace(/\/$/, '');
  // No API configured: serving the marketing site is still better than 404ing
  // every request, and a tenant host without an API would have nothing to
  // render anyway.
  if (!apiUrl) return { kind: 'unavailable' };

  const doFetch = deps.fetch ?? fetch;
  const query = `host=${encodeURIComponent(host)}&path=${encodeURIComponent(pathname)}`;

  let response: Response;
  try {
    response = await doFetch(`${apiUrl}/public/microsites/resolve?${query}`, {
      signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
    });
  } catch {
    return { kind: 'unavailable' };
  }

  // 404 (unknown host) and 400 (unusable host header) are both "there is no
  // site here". 5xx is an outage and must not be cached or shown as a 404.
  if (response.status === 404 || response.status === 400) {
    return { kind: 'not-found' };
  }
  if (!response.ok) return { kind: 'unavailable' };

  let site: Partial<ResolvedMicrositeHost>;
  try {
    site = (await response.json()) as Partial<ResolvedMicrositeHost>;
  } catch {
    return { kind: 'unavailable' };
  }
  if (!site.slug || !site.micrositeId) return { kind: 'not-found' };

  return {
    kind: 'rewrite',
    path: micrositeRewritePath(site.slug, pathname, search),
    site: site as ResolvedMicrositeHost,
  };
};

/**
 * The unknown-host page. Deliberately a self-contained response rather than a
 * rewrite to `/404`: that route is prerendered marketing chrome, and a host we
 * do not recognise should not be served a branded page at all. Never cached —
 * a cached 404 outlives the DNS fix that resolves it.
 */
export const micrositeHostErrorResponse = (
  kind: 'not-found' | 'unavailable'
): Response => {
  const status = kind === 'not-found' ? 404 : 503;
  const title =
    kind === 'not-found' ? 'Site not found' : 'Temporarily unavailable';
  const message =
    kind === 'not-found'
      ? 'There is no site configured for this address.'
      : 'This site is temporarily unavailable. Please try again in a moment.';

  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;margin:0"><main><h1 style="font-size:1.25rem;margin:0 0 .5rem">${title}</h1><p style="color:#555;margin:0">${message}</p></main></body></html>`,
    {
      status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    }
  );
};
