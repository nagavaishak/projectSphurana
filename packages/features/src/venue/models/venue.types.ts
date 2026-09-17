import type { OrganizationPhoto } from '@borradh-workspace/database';
import type {
  CountryCode,
  ServicePriceType,
  VenueAmenity,
} from '@borradh-workspace/labels';
import type { Currency } from '../../shared/index.js';

/**
 * The public venue page view-model returned by `get-venue-config`.
 *
 * A venue IS a location: the page is scoped to ONE location (a physical branch)
 * of an organization. `organization` carries the shared brand fields; `location`
 * carries the venue-specific fields (about/amenities/address/geo/hours) that now
 * live on `organization_location`, not on `organization`.
 *
 * Dates on `photos` are Drizzle `Date` objects here; the API serializes them to
 * ISO strings on the wire, and the `venueConfigSchema` contract validates the
 * serialized (string) shape. See packages/contracts/src/responses/org.ts.
 */
export interface VenueConfigOrg {
  name: string;
  slug: string;
  logo: string | null;
  timezone: string;
  reschedulingNoticeRequiredHours: number | null;
  noShowOrLateCancelFeeCents: number | null;
}

/** A weekly opening-hours map: day-of-week (0=Sun..6=Sat) → minutes-from-midnight. */
export type VenueOpeningHours = Record<number, { from: number; to: number }>;

/** The venue itself — one physical location/branch of the organization. */
export interface VenueConfigLocation {
  id: string;
  slug: string | null;
  name: string | null;
  about: string | null;
  amenities: VenueAmenity[];
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  county: string | null;
  postalCode: string | null;
  country: CountryCode;
  latitude: number | null;
  longitude: number | null;
  openingHours: VenueOpeningHours | null;
}

/**
 * A customer-chosen pricing option on a service, as exposed to the public venue
 * page / booking wizard. A subset of the full `organization_service_variant`
 * row — only the fields a customer picks between.
 */
export interface VenueConfigServiceVariant {
  id: string;
  name: string;
  priceCents: number | null;
  /** Overrides the service default when set; null = use the service duration. */
  durationMinutes: number | null;
}

export interface VenueConfigService {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  /** DEPRECATED freeform price — kept through the transition; derive display
   *  from (priceType, priceCents, variants) via `formatServicePrice`. */
  priceText: string | null;
  /** Structured price shape (fixed | from | free | poa). */
  priceType: ServicePriceType;
  priceCents: number | null;
  appointmentDuration: number | null;
  /** Active variants, by sortOrder. Empty for the 92% of single-price services. */
  variants: VenueConfigServiceVariant[];
}

export interface VenueConfigTeamMember {
  id: string;
  name: string;
  photo: string | null;
  title: string | null;
  bio: string | null;
}

export interface VenueConfig {
  organization: VenueConfigOrg;
  location: VenueConfigLocation;
  /**
   * The org's single display currency, derived from the venue location's country
   * (fallback: EUR). Every `priceCents` on this page is in it. Lets the frontend
   * render prices via `formatServicePrice` without guessing the symbol.
   */
  currency: Currency;
  photos: OrganizationPhoto[];
  services: VenueConfigService[];
  team: VenueConfigTeamMember[];
}
