/**
 * Links from the app into a clinic's MICROSITE.
 *
 * Booking and the customer portal moved out of this app and onto the tenant's
 * microsite, which the marketing app serves. So any link from here to those
 * surfaces has to leave this origin.
 *
 * The marketing host is derived from the current one (`app.x` → `www.x`) rather
 * than read from config, for the same reason marketing derives `app.${host}`
 * when it bounces stale `/dashboard` links: it keeps previews, staging and
 * local dev pointing at their own sibling deployment instead of production.
 *
 * Only the PATH tier exists today (`/sites/{slug}/…`). When wildcard subdomains
 * and custom domains ship, a tenant's booking page lives on their own host and
 * this helper must resolve it from `microsite_domain` — at which point this is
 * the single place to change.
 */

/**
 * The marketing origin this deployment should link to.
 *
 * TOLD, not guessed. `GET /organization/active` reports `marketingUrl`,
 * because the API is the only party that knows it in every environment (it is
 * committed config in `.github/prod.env`, and CI sets it per-PR). Cached here
 * so link builders stay synchronous — the dashboard fetches the active org
 * before it can render anything that links out.
 */
let reportedOrigin: string | null = null;

/** Called by the active-organization query as soon as it resolves. */
export function setMarketingOrigin(url: string | null | undefined): void {
  reportedOrigin = url?.replace(/\/$/, '') || null;
}

function marketingOrigin(): string {
  if (reportedOrigin) return reportedOrigin;
  if (typeof window === 'undefined') return '';
  const { protocol, host } = window.location;
  // Fallback only, for the window before the org query resolves: app.x → www.x.
  //
  // It is ONLY correct in production. On a Vercel preview the dashboard has a
  // branch alias (`borradh-app-git-{branch}-{team}`) and the marketing project
  // does not — its previews are deployment-hash URLs — so there is nothing to
  // derive, the host is left alone, and every customer link stayed on the
  // dashboard host and 404'd. That is what `marketingUrl` above fixes.
  return host.startsWith('app.')
    ? `${protocol}//${host.replace(/^app\./, 'www.')}`
    : `${protocol}//${host}`;
}

/** A clinic's public booking page. */
export function micrositeBookingUrl(
  organizationSlug: string,
  serviceId?: string
): string {
  const base = `${marketingOrigin()}/sites/${encodeURIComponent(organizationSlug)}/book`;
  return serviceId ? `${base}/${encodeURIComponent(serviceId)}` : base;
}

/**
 * A clinic's public VENUE page.
 *
 * Moved to marketing with booking and the portal — it is public, indexable and
 * customer-facing, so sending a customer to `app.` to read an address was
 * always wrong — and it hangs off the microsite base like they do, rather than
 * keeping a top-level shape of its own. Both older forms redirect here for
 * links already in the wild.
 *
 * Retired once microsites go live: the microsite covers the same ground.
 */
export function micrositeVenueUrl(
  organizationSlug: string,
  locationSlug?: string
): string {
  const base = `${marketingOrigin()}/sites/${encodeURIComponent(organizationSlug)}/venue`;
  return locationSlug ? `${base}/${encodeURIComponent(locationSlug)}` : base;
}
