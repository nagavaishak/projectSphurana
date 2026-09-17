/**
 * CARRYING A MICROSITE VISIT'S ATTRIBUTION INTO THE BOOKING FLOW (plan §9, §11).
 *
 * The ad click lands on the microsite (`salon.com/?utm_source=meta&…`) but the
 * lead is created on the BOOKING page, which is a different route — `/book/*`
 * is deliberately excluded from microsite rewriting, so it has no idea which
 * site sent the visitor. Without this the UTMs die on the landing page and
 * `computeCampaignCac` has nothing to join spend against.
 *
 * WHAT TRAVELS: `micrositeId` and the five utm params. NEVER the host. A tenant
 * moving from `salon.borradh.io` to `salon.com` must keep ONE attribution
 * history, and the host is the one identifier that changes when they do.
 *
 * Pure and synchronous — it runs in an Astro page's frontmatter and in a React
 * event handler, and must work in both.
 */

/** Query key naming the microsite on the booking URL. Short: it is user-visible. */
export const MICROSITE_ATTRIBUTION_PARAM = 'ms';

const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const;

/**
 * The booking URL with this visit's attribution attached.
 *
 * Existing params on `bookingUrl` win — a caller that already tagged the link
 * (an email or an ad builder) knows more than the current page's query string.
 * Returns the input unchanged when there is nothing to add, so a microsite with
 * no attribution renders byte-identical markup.
 */
export const withMicrositeAttribution = (
  bookingUrl: string,
  attribution: { micrositeId?: string | null; search?: string | null }
): string => {
  const incoming = new URLSearchParams(attribution.search ?? '');
  const carry: [string, string][] = [];

  if (attribution.micrositeId) {
    carry.push([MICROSITE_ATTRIBUTION_PARAM, attribution.micrositeId]);
  }
  for (const key of UTM_KEYS) {
    const value = incoming.get(key);
    if (value) carry.push([key, value]);
  }
  if (carry.length === 0) return bookingUrl;

  // `bookingUrl` is absolute on every tier today, but a host-relative override
  // is an explicitly planned change — so parse against a base rather than
  // assuming absolute, and fall back to string concatenation if even that fails.
  let url: URL;
  try {
    url = new URL(bookingUrl, 'https://placeholder.invalid');
  } catch {
    return bookingUrl;
  }
  for (const [key, value] of carry) {
    if (!url.searchParams.has(key)) url.searchParams.set(key, value);
  }
  return bookingUrl.startsWith('http')
    ? url.toString()
    : `${url.pathname}${url.search}`;
};

/**
 * What the booking page should SEND: the full URL it is on (UTMs included) and
 * the microsite that sent the visitor, if any.
 *
 * The landing URL is passed whole rather than pre-parsed because the server
 * owns which params count — see `attachLeadAttribution`.
 */
export const readMicrositeAttribution = (
  href: string
): { micrositeId?: string; landingUrl?: string } => {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return {};
  }
  const micrositeId = url.searchParams.get(MICROSITE_ATTRIBUTION_PARAM);
  return {
    micrositeId: micrositeId || undefined,
    landingUrl: url.href,
  };
};
