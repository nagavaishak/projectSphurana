/**
 * The VIEW-SHAPED payload the microsite renderer consumes — the live business
 * data that data-bound blocks (services, team, opening_hours, map_location)
 * render. Blocks hold a QUERY; this is what that query resolves to.
 *
 * Deliberately view-shaped, not DB-shaped:
 *   - prices arrive PRE-FORMATTED via `formatServicePrice()`. The renderer must
 *     never re-derive a price, or the site disagrees with the booking widget.
 *   - opening hours arrive as localised label strings.
 *   - `mapEmbedUrl` arrives ready to embed (provider + key are a server concern).
 *
 * WHY THIS IS HERE and not in either app: it was written twice — once in
 * `apps/api` to produce it, once in `apps/marketing-astro` to consume it — and
 * two copies of one wire format drift silently. The same thing already happened
 * with block variants, where the two sides disagreed on all eight blocks and
 * nothing failed; the symptom is a section quietly vanishing from a live tenant
 * page. One declaration, both sides import it.
 */

export interface MicrositeAsset {
  id: string;
  url: string;
  alt?: string;
  /** Intrinsic size. Required for the LCP budget — CLS costs us conversions. */
  width?: number;
  height?: number;
}

export interface MicrositeService {
  id: string;
  name: string;
  description?: string;
  /** Free-text category NAME from `organization_service.category`, not an id. */
  categoryName?: string;
  /** Already formatted by `formatServicePrice()`. Never a raw number here. */
  priceLabel?: string;
  durationLabel?: string;
  imageAssetId?: string;
}

export interface MicrositePractitioner {
  id: string;
  name: string;
  role?: string;
  bio?: string;
  imageAssetId?: string;
}

export interface MicrositeOpeningHoursDay {
  /** Localised day name, e.g. "Monday". */
  label: string;
  /** Localised ranges, e.g. ["09:00 – 17:00"]. Empty = closed. */
  intervals: string[];
}

export interface MicrositeOpeningHoursException {
  label: string;
  detail: string;
}

export interface MicrositeLocation {
  id: string;
  name: string;
  /** Pre-formatted address lines, in display order. */
  addressLines: string[];
  phone?: string;
  email?: string;
  latitude?: number;
  longitude?: number;
  /**
   * A ready-to-embed map URL, built server-side. The renderer never assembles
   * a maps URL itself — provider and API key are a server concern.
   */
  mapEmbedUrl?: string;
  /** A "get directions" link for the address. */
  directionsUrl?: string;
  openingHours?: MicrositeOpeningHoursDay[];
  openingHoursExceptions?: MicrositeOpeningHoursException[];
}

export interface MicrositeData {
  /** Assets addressable by id — `hero.imageAssetId`, `gallery.assetIds`, etc. */
  assets: Record<string, MicrositeAsset>;
  /** Active services, already filtered to what may be shown publicly. */
  services: MicrositeService[];
  /** Active practitioners. */
  practitioners: MicrositePractitioner[];
  /** All public locations. `locationId` on a block selects one; absent = first. */
  locations: MicrositeLocation[];
  /** The org photo gallery, used when a gallery block names no asset ids. */
  gallery: MicrositeAsset[];
  /** Absolute or internal booking URL — the primary conversion target. */
  bookingUrl: string;
  /** Business name, used for image alt text and map labels. */
  businessName: string;
}
