import type { VenueConfig } from '@borradh-workspace/contracts';

type VenueLocation = VenueConfig['location'];

/** A single-line, comma-joined address (empty parts dropped). */
export function formatAddress(location: VenueLocation): string {
  return [
    location.addressLine1,
    location.addressLine2,
    location.city,
    location.county,
    location.postalCode,
    location.country,
  ]
    .filter((part): part is string => !!part && part.trim().length > 0)
    .join(', ');
}

/** A short address for the hero line: street + city. */
export function formatShortAddress(location: VenueLocation): string {
  return [location.addressLine1, location.city]
    .filter((part): part is string => !!part && part.trim().length > 0)
    .join(', ');
}

/**
 * A Google Maps "directions" link. Prefer exact coordinates when present (they
 * drop the pin precisely); otherwise fall back to the text address.
 */
export function directionsUrl(location: VenueLocation): string {
  const query =
    location.latitude != null && location.longitude != null
      ? `${location.latitude},${location.longitude}`
      : formatAddress(location);
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
}

/**
 * A self-contained Google Maps embed URL (no API key needed). Only available
 * when we have coordinates — the page skips the map otherwise.
 */
export function mapEmbedUrl(location: VenueLocation): string | null {
  if (location.latitude == null || location.longitude == null) return null;
  return `https://www.google.com/maps?q=${location.latitude},${location.longitude}&output=embed`;
}
