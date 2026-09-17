/**
 * Which organization is this request for?
 *
 * There are three microsite tiers (plan §9) and they answer this differently:
 *
 *   salonname.com/portal            → the HOST names the org (custom tier)
 *   glow-clinic.borradh.io/portal   → the HOST names the org (wildcard tier)
 *   www.borradh.io/sites/glow/portal → the PATH names the org (path tier)
 *
 * Phase 1 shipped only the path tier, so today every microsite request resolves
 * by path. Wildcard and custom hosts arrive later. This helper exists so that
 * switch is a routing change and not a rewrite of every page: callers ask for
 * "the org for this request" and never parse a URL themselves.
 *
 * IMPORTANT: this is a CLIENT-SIDE convenience for building links. The
 * authoritative resolution is server-side via `GET public/microsites/resolve`
 * — a page must never trust a slug the browser derived for anything that
 * reads or writes data.
 */

/** Hosts we serve microsites from; anything else is treated as a custom domain. */
const PLATFORM_HOSTS = ['borradh.io', 'borradh-dev.com'];

export interface MicrositeOrgContext {
  /** The org slug for this request. */
  slug: string;
  /** How it was resolved — useful for building correct outbound links. */
  tier: 'custom' | 'wildcard' | 'path';
  /**
   * Prefix every in-microsite link with this. Empty on host tiers, `/sites/x`
   * on the path tier. Building a link without it is how you end up sending a
   * customer from a tenant's site back to ours.
   */
  basePath: string;
}

const platformSuffix = (hostname: string): string | null =>
  PLATFORM_HOSTS.find((h) => hostname === h || hostname.endsWith(`.${h}`)) ??
  null;

/**
 * Resolve from a URL. Server-side the page should pass `Astro.url`; client-side
 * pass `window.location`.
 */
export function resolveMicrositeOrg(url: {
  hostname: string;
  pathname: string;
}): MicrositeOrgContext | null {
  const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  const suffix = platformSuffix(hostname);

  // Path tier: /sites/{slug}/… on one of our own hosts.
  const pathMatch = /^\/sites\/([^/?#]+)/.exec(url.pathname);
  if (pathMatch) {
    const slug = decodeURIComponent(pathMatch[1]);
    return { slug, tier: 'path', basePath: `/sites/${slug}` };
  }

  if (suffix) {
    // Wildcard tier: exactly one label in front of the platform host. A nested
    // subdomain is not a tenant — treating it as one would let anyone who can
    // create a CNAME claim a slug.
    const label = hostname.slice(0, -(suffix.length + 1));
    if (label && !label.includes('.')) {
      return { slug: label, tier: 'wildcard', basePath: '' };
    }
    return null;
  }

  // Custom tier: the host itself is the tenant's. The SLUG is not derivable
  // from it — the server resolves that — so callers on a custom domain must be
  // given the slug rather than guessing one from the hostname.
  return null;
}

/** Build an in-microsite link that is correct on every tier. */
export function micrositeLink(
  ctx: Pick<MicrositeOrgContext, 'basePath'>,
  path: string
): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${ctx.basePath}${suffix}`;
}
