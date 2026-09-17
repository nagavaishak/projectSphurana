/**
 * WHERE A BRANCH SITS IN A PUBLIC URL — the one definition, shared.
 *
 * These paths are built on both sides of the wire: the marketing app renders
 * the chooser cards and the venue page's Book buttons, and the backend composes
 * the links Claire sends a customer in Messenger and WhatsApp. Those two must
 * agree exactly. They did not before this module existed — the chatbot emitted
 * a branch-less `/book/{serviceId}`, so Claire quoted one branch's price and
 * then sent a link that asked the customer which branch they meant.
 *
 * `web-shared` is the only package both `features` and `apps/marketing-astro`
 * already depend on, which is why it lives here rather than beside either
 * caller.
 *
 * Base-relative on purpose. The ORIGIN and the tier (path vs custom domain) are
 * a separate decision made once per caller — `micrositeLink` in the marketing
 * app, `micrositeBase` in features — and folding it in here would mean two
 * places deciding which host a tenant's links belong on.
 */

/**
 * The segment that separates a branch from a service id under a microsite.
 *
 * `/book/{serviceId}` already occupies the bare slot, so a bare `{branch}`
 * would need a disambiguating lookup on every request and would break the day
 * a location slug collides with a service id. It also mirrors `/dashboard/l/…`,
 * so one convention covers both halves of the product.
 */
export const BRANCH_SEGMENT = 'l';

/**
 * How a branch is NAMED in a URL: its slug, or its id when it has none.
 *
 * `organization_location.slug` is nullable and stays nullable until the
 * backfill runs, but an id always exists — so every branch is addressable
 * today, with no data migration in front of it. `resolveBookingLocation`
 * resolves either, which is what makes this safe rather than hopeful.
 *
 * Prefer the slug when there is one: it is the readable, shareable form, and it
 * is what a customer sees in a link Claire sends them.
 */
export function branchSegmentFor(location: {
  id: string;
  slug?: string | null;
}): string {
  return location.slug && location.slug.length > 0
    ? location.slug
    : location.id;
}

/** One branch's booking wizard, optionally deep-linked to a service. */
export function branchBookingPath(
  branchSegment: string,
  serviceId?: string
): string {
  const branch = `/${BRANCH_SEGMENT}/${encodeURIComponent(branchSegment)}/book`;
  return serviceId ? `${branch}/${encodeURIComponent(serviceId)}` : branch;
}

/** One branch's public venue page. */
export function branchVenuePath(branchSegment: string): string {
  return `/${BRANCH_SEGMENT}/${encodeURIComponent(branchSegment)}/venue`;
}

/**
 * Back to the chooser — the "View all locations" destination.
 *
 * `/book` rather than a dedicated `/l` index because `/book` ALREADY is the
 * all-locations view: it applies the entry rules and renders the chooser. A
 * second page listing the same branches would be a second thing to keep in step
 * for no new capability.
 */
export function allBranchesPath(): string {
  return '/book';
}
