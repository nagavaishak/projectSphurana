/**
 * Which URL a block's booking CTA should actually point at.
 *
 * Provisioning used to bake `ctaHref: '/book'` into the hero block, so that
 * literal is PERSISTED in every document created before it was removed. On the
 * path tier it resolves to `{host}/book`, which is not a route — the CTA 404s,
 * and fixing the provisioner alone does nothing for a site that already
 * exists.
 *
 * So a stored href that names the booking flow in its retired shape is treated
 * as "the booking flow", not as a custom link, and gives way to the resolved
 * `bookingUrl` — which is the only value that can be correct on every tier.
 * Anything else a person deliberately typed is honoured untouched.
 *
 * Deliberately narrow: only the shapes provisioning itself emitted (`/book`,
 * `/book/{slug}`). A tenant whose custom link genuinely is `/book-online`, or
 * an absolute URL to their old booking system, keeps it.
 */
const RETIRED_BOOKING_PATH = /^\/book(?:\/|$)/;

export function resolveBookingHref(
  storedHref: string | undefined | null,
  resolvedBookingUrl: string | undefined | null
): string | undefined {
  const stored = storedHref?.trim();
  const resolved = resolvedBookingUrl?.trim();

  if (!stored) return resolved || undefined;
  if (RETIRED_BOOKING_PATH.test(stored)) return resolved || stored;
  return stored;
}
