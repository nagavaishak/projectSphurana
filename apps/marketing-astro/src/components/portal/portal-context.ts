/**
 * Which clinic's portal is this request for, and how do we link within it?
 *
 * WHY THIS EXISTS
 * apps/app resolved the org from a TanStack Router param (`$organizationSlug`)
 * and `patient-fetch.ts` re-derived it a second time by regexing the pathname.
 * Neither survives the move: there is no router here, and the pathname regex is
 * actively wrong under host-implies-org (`/portal/bookings` would yield the org
 * slug "bookings").
 *
 * So the slug is resolved ONCE, server-side, in the Astro page frontmatter, and
 * handed down to islands as a prop. `resolveMicrositeOrg` is the single
 * authority; this module only adapts it to the portal's shape and gives every
 * link a builder that is correct on all three tiers.
 *
 * Every in-portal link MUST go through `portalLink`. A hardcoded `/portal/x`
 * works on our own domain and silently sends a tenant's customer off the
 * tenant's site the moment the wildcard/custom tiers ship.
 */
import {
  type MicrositeOrgContext,
  micrositeLink,
  resolveMicrositeOrg,
} from '@/lib/microsite-org';

export interface PortalContext {
  /** The clinic this portal belongs to. */
  organizationSlug: string;
  /** `''` on host tiers, `/sites/{slug}` on the path tier. */
  basePath: string;
  /** How the slug was resolved — carried through for diagnostics. */
  tier: MicrositeOrgContext['tier'];
}

/**
 * Resolve from a request. Server-side pass `Astro.url` plus the forwarded
 * `host` header (behind Vercel, `Astro.url.hostname` is the internal rewrite
 * host, not the one the customer typed).
 *
 * Returns `null` when the org cannot be determined — today that is only the
 * custom-domain tier, which has no slug derivable from the hostname. Callers
 * render an "unavailable" shell rather than guessing, because guessing here
 * means showing one clinic's customer another clinic's portal.
 */
export function resolvePortalContext(url: {
  hostname: string;
  pathname: string;
}): PortalContext | null {
  const resolved = resolveMicrositeOrg(url);
  if (!resolved) return null;
  return {
    organizationSlug: resolved.slug,
    basePath: resolved.basePath,
    tier: resolved.tier,
  };
}

/**
 * Build a link to a page INSIDE the portal.
 *
 * `subpath` is relative to the portal root: `''` → the portal home,
 * `'/sign-in'` → the sign-in page.
 */
export function portalLink(
  ctx: Pick<PortalContext, 'basePath'>,
  subpath = ''
): string {
  const suffix = subpath === '' || subpath === '/' ? '' : subpath;
  return micrositeLink(ctx, `/portal${suffix}`);
}

/**
 * The public booking flow for this clinic.
 *
 * Prefixed with `basePath` like every other surface: booking hangs off the
 * microsite base (`/sites/{slug}/book` on the path tier, `/book` on a tenant's
 * own host). It briefly lived at a top-level `/book/{slug}`, inherited from the
 * dashboard app — that shape now 301s here, so old links still resolve, but
 * nothing should BUILD one.
 */
export function portalBookingLink(ctx: PortalContext): string {
  return micrositeLink(ctx, '/book');
}

/**
 * Resolve from an Astro request.
 *
 * The forwarded `host` header wins over `url.hostname`: behind Vercel the URL's
 * host is the internal rewrite target, not the domain the customer typed — the
 * same reason `src/pages/sites/[slug]/[...path].astro` reads the header. Get
 * this wrong and every wildcard/custom-tier request resolves to the platform
 * host and finds no org.
 */
export function resolvePortalContextFromRequest(
  request: Request,
  url: URL,
  /**
   * What the middleware already resolved for this request (`Astro.locals.
   * microsite`), when there is one.
   *
   * WHY THIS OVERRIDE EXISTS: on a wildcard or custom host the middleware
   * rewrites `salon.com/portal` to `/sites/{slug}/portal` internally, so by the
   * time a page reads `url.pathname` it looks exactly like the path tier — and
   * link building would then prefix every in-portal link with `/sites/{slug}`.
   * The visitor's first URL is clean, but their SECOND one would not be: they
   * would click through from `salon.com/portal` to
   * `salon.com/sites/acme/portal/bookings`, on the tenant's own domain. That
   * defeats the point of them having a domain.
   *
   * The middleware knows the real tier, so it wins. Slug still comes from the
   * server — never guessed from the hostname.
   */
  resolved?: { slug: string; tier: 'custom' | 'wildcard' | 'path' } | null
): PortalContext | null {
  if (resolved) {
    return {
      organizationSlug: resolved.slug,
      tier: resolved.tier,
      // On the tenant's own host the org is implied — no prefix.
      basePath: resolved.tier === 'path' ? `/sites/${resolved.slug}` : '',
    };
  }

  const hostHeader = request.headers.get('host') ?? url.host;
  // Strip any port; `resolveMicrositeOrg` matches on hostname alone.
  const hostname = hostHeader.split(':')[0] ?? url.hostname;
  return resolvePortalContext({ hostname, pathname: url.pathname });
}
