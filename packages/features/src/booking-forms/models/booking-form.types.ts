import type { LocationOpeningHours } from '@borradh-workspace/database';
import type { CountryCode, ServicePriceType } from '@borradh-workspace/labels';
import type { Currency } from '../../shared/index.js';
import type {
  BookingPaymentDefaults,
  BookingPaymentService,
  ResolvedBookingPayment,
} from '../shared/resolve-booking-payment.js';

/**
 * An available time slot for booking
 */
export interface AvailableSlot {
  startTime: Date;
  endTime: Date;
}

/**
 * A practitioner's availability summary for the booking form
 */
export interface PractitionerAvailability {
  practitioner: {
    id: string;
    name: string;
    photo: string | null;
    title: string | null;
  };
  slots: AvailableSlot[];
}

/**
 * Full available-slots response for a booking.
 * - `slots` contains the merged "any available" slots across all practitioners.
 * - `byPractitioner` is only present when practitioner selection is allowed.
 */
export interface AvailableSlotsResponse {
  slots: AvailableSlot[];
  byPractitioner?: PractitionerAvailability[];
}

/**
 * General booking page configuration (no formId required)
 */
export interface GeneralBookingConfig {
  organizationName: string;
  organizationSlug: string;
  organizationLogo: string | null;
  /** Business time zone — the wizard renders every slot/time in this. */
  timezone: string;
  /** Cancellation-policy inputs for the Confirm step's info box. */
  reschedulingNoticeRequiredHours: number | null;
  noShowOrLateCancelFeeCents: number | null;
  /**
   * The org-level payment defaults every service inherits, in exactly the shape
   * `resolveBookingPayment` takes.
   *
   * Shipped as resolver INPUT rather than a pre-computed amount because what is
   * due depends on the cart the customer builds. It is the resolver's own input
   * type on purpose: the page cannot answer "what will this cost online?" a
   * second, divergent way.
   *
   * This replaced `depositEnabled` / `depositAmountCents`. Those were the
   * pre-policy fields, and the page kept reading them after the server moved to
   * `payment_policy` — so a clinic whose policy resolved to `in_clinic` still
   * got a "Pay deposit & book" button, and was then charged nothing.
   */
  paymentDefaults: BookingPaymentDefaults;
  /**
   * The org's single display currency, from the primary location's country
   * (fallback: EUR). Every `priceCents` here is in it; the wizard renders prices
   * via `formatServicePrice` with `currency.symbol`.
   */
  currency: Currency;
  services: Array<{
    id: string;
    name: string;
    /** DEPRECATED freeform price (was `priceText`). Kept through the transition;
     *  derive display from (priceType, priceCents, variants). */
    pricingDescription: string | null;
    /** Structured price shape (fixed | from | free | poa). */
    priceType: ServicePriceType;
    /** Machine-readable price for the running cart total. Null = "from"/POA. */
    priceCents: number | null;
    /** Drives the category chips on the Services step. The org's OWN category
     *  name, or null when the service has none — never the legacy enum. */
    category: string | null;
    appointmentDuration: number | null;
    description: string | null;
    /**
     * This service's own payment configuration, in the resolver's input shape.
     * A null `paymentPolicy` means "inherit `paymentDefaults`", NOT "pay in
     * clinic" — 1,696 of the catalogue's active services are exactly that.
     */
    payment: Omit<BookingPaymentService, 'priceType' | 'priceCents'>;
    /** Active variants, by sortOrder. Empty for single-price services. */
    variants: Array<{
      id: string;
      name: string;
      priceCents: number | null;
      durationMinutes: number | null;
    }>;
  }>;
  /** Active practitioners for the Professional step ("any" is offered too). */
  practitioners: Array<{
    id: string;
    name: string;
    photo: string | null;
    title: string | null;
    /**
     * IDs of the services this practitioner is assigned to (via
     * practitioner_service). The Professional step offers a practitioner only
     * for services they can actually perform — otherwise picking them yields a
     * dead-end with no available times.
     */
    serviceIds: string[];
  }>;
}

/**
 * Result of submitting a general booking (no form record)
 */
export interface GeneralBookingResult {
  leadId: string;
  appointmentId: string;
  appointmentStartTime: Date;
  appointmentEndTime: Date;
  /**
   * Set when the clinic requires a deposit and a Stripe checkout session was
   * created for it. The booking is created regardless; this just surfaces the
   * "Pay £X deposit" call-to-action on the confirmation screen. Null when no
   * deposit is configured (£0) or when payment could not be set up (e.g. the
   * clinic has not connected Stripe) — in that case the booking simply
   * confirms without a payment step.
   */
  deposit?: {
    amountCents: number;
    currency: string;
    checkoutUrl: string;
    /**
     * Why this amount is owed, straight from `resolveBookingPayment`. The
     * confirmation screen needs it to name the charge: `full` is the whole
     * price, not a deposit, and calling it one is the same mislabelling that
     * put a "Pay deposit & book" button on a booking that charged nothing.
     */
    reason: ResolvedBookingPayment['reason'];
  } | null;
}

/**
 * One bookable branch on the public branch chooser
 * (`GET /public/booking/:organizationSlug/locations`).
 *
 * A DELIBERATELY SMALL projection. This is an anonymous endpoint, and it is the
 * FIRST thing a member of the public loads — the only question it answers is
 * "which of these branches do I want to book at?", so it carries exactly what a
 * chooser card renders and nothing else. Anything richer (services, prices,
 * team, gallery) is one click away on the branch's own config/venue payload,
 * where a branch has actually been chosen.
 */
export interface BookingLocationSummary {
  id: string;
  /**
   * The branch segment of the URL the card links to
   * (`/sites/{org}/book/l/{slug}`). Nullable because `organization_location.slug`
   * still is — a row the backfill has not reached cannot be linked to by slug,
   * and the chooser falls back to the org-level form for it rather than
   * rendering a dead link.
   */
  slug: string | null;
  /** Branch name ("Dublin Branch"). Null for orgs that never named one. */
  name: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  county: string | null;
  postalCode: string | null;
  country: CountryCode;
  /** For a map pin / "nearest branch" ordering done client-side. */
  latitude: number | null;
  longitude: number | null;
  /**
   * The weekly opening-hours summary the card prints ("Mon–Fri 9–17"), resolved
   * the SAME way the venue page resolves it: this branch's standing hours, else
   * the org's business hours. Null when neither is set.
   */
  openingHours: LocationOpeningHours | null;
  /**
   * One card image: this branch's cover photo, else its first gallery photo,
   * else the org-wide cover/first. Null when the org has no photos at all.
   */
  photo: string | null;
  /** True for the org's primary branch — the card the chooser highlights. */
  isPrimary: boolean;
}

/** `GET /public/booking/:organizationSlug/locations`. */
export interface BookingLocationsResponse {
  organizationName: string;
  organizationSlug: string;
  organizationLogo: string | null;
  locations: BookingLocationSummary[];
}
