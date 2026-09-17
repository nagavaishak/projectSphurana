/**
 * WHICH CLINIC is this booking request for — decided once, server-side.
 *
 * The islands under `@/components/booking` take the org as a PROP and never
 * look at `window.location`. This is the one place that decides it, so a
 * component cannot become a second, disagreeing authority (which is exactly how
 * `patientFetch` used to 401 every call under host-implies-org: it re-derived
 * the slug from a path shape that no longer carried one).
 *
 * Two tiers can reach these routes:
 *  - Platform / tenant host today: `/book/{slug}/…` — the route param names
 *    the org and links need no prefix.
 *  - Microsite path tier tomorrow: `/sites/{slug}/book/…` — the PATH names
 *    the org and every internal link must carry `/sites/{slug}`.
 *
 * `resolveMicrositeOrg` answers the second; the route param is the fallback for
 * the first. Both produce a `basePath`, and every link built from it goes
 * through `micrositeLink`, so moving to per-tenant hosts is a routing change
 * rather than a rewrite of the flow.
 *
 * NOTE this mirrors the client-side helper's own caveat: a slug derived from a
 * URL is fine for building links, and is NOT authority for reading or writing
 * data. The API resolves the org per request from the slug it is given.
 */

import {
  type MicrositeOrgContext,
  resolveMicrositeOrg,
} from '@/lib/microsite-org';

export interface BookingOrg {
  slug: string;
  orgContext: Pick<MicrositeOrgContext, 'basePath'>;
}

export function resolveBookingOrg(
  url: { hostname: string; pathname: string },
  routeSlug: string | undefined
): BookingOrg {
  const microsite = resolveMicrositeOrg(url);
  if (microsite) {
    return {
      slug: microsite.slug,
      orgContext: { basePath: microsite.basePath },
    };
  }
  return { slug: routeSlug ?? '', orgContext: { basePath: '' } };
}
