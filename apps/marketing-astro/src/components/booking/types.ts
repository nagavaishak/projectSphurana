/**
 * Wire types for the public booking API, inlined.
 *
 * apps/app gets these from `@borradh-workspace/api-client/types`, which derives
 * them from the backend `features` + `contracts` packages. The marketing app
 * deliberately depends on NO `@borradh-workspace/*` runtime package (importing
 * api-client pulls in the whole backend features + database tree), so this is a
 * hand-kept snapshot of the SAME shapes.
 *
 * This is a fuller snapshot than `src/features/booking-forms/api/types.ts`,
 * which predates the cart wizard: it carries `timezone`, `practitioners`,
 * per-service `category` + `payment`, the org `paymentDefaults`, the
 * cancellation-policy inputs, the `deposit` on a submit result, and the
 * multi-service `serviceIds` / `serviceItems` on the submit input. The older
 * file is left untouched so the existing /book flow keeps working.
 */

// ---------------------------------------------------------------------------
// Payment vocabulary (mirrors @borradh-workspace/labels)
// ---------------------------------------------------------------------------

export type ServicePriceType = 'fixed' | 'from' | 'free' | 'poa';
export type ServicePaymentPolicy = 'in_clinic' | 'deposit' | 'full';
export type DepositBasis = 'fixed' | 'percent';
export type DepositAggregation = 'sum' | 'largest';

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

export interface TimeSlot {
  startTime: string; // ISO string
  endTime: string; // ISO string
}

export interface PractitionerAvailability {
  practitioner: {
    id: string;
    name: string;
    photo: string | null;
    title: string | null;
  };
  slots: TimeSlot[];
}

export interface AvailableSlotsResponse {
  slots: TimeSlot[];
  byPractitioner?: PractitionerAvailability[];
}

// ---------------------------------------------------------------------------
// Payment resolver input shapes
// ---------------------------------------------------------------------------

/** The org-level defaults every service inherits when it sets none of its own. */
export interface BookingPaymentDefaults {
  defaultPaymentPolicy: ServicePaymentPolicy;
  defaultDepositBasis: DepositBasis;
  defaultDepositAmountCents: number | null;
  defaultDepositPercent: number | null;
  depositAggregation: DepositAggregation;
}

/** One booked service, as the resolver sees it. */
export interface BookingPaymentService {
  priceType: ServicePriceType;
  priceCents: number | null;
  paymentPolicy: ServicePaymentPolicy | null;
  depositBasis: DepositBasis | null;
  depositAmountCents: number | null;
  depositPercent: number | null;
}

export interface ResolvedBookingPayment {
  /** What to charge online, in cents. 0 means "nothing due at booking". */
  amountCents: number;
  /**
   * Why. `mixed` means at least one service prepays in full and another takes a
   * deposit — the amount is the sum, and the remainder is still due at the POS.
   */
  reason: 'none' | 'deposit' | 'full' | 'mixed';
}

// ---------------------------------------------------------------------------
// Public booking config
// ---------------------------------------------------------------------------

export interface GeneralBookingConfigService {
  id: string;
  name: string;
  /** DEPRECATED freeform price — derive display from the structured fields. */
  pricingDescription?: string | null;
  priceType: ServicePriceType;
  priceCents: number | null;
  /** Drives the category chips on the Services step. */
  category?: string | null;
  appointmentDuration: number | null;
  description: string | null;
  /** Null `paymentPolicy` = inherit `paymentDefaults`, NOT "pay in clinic". */
  payment?: Omit<BookingPaymentService, 'priceType' | 'priceCents'>;
  variants?: Array<{
    id: string;
    name: string;
    priceCents: number | null;
    durationMinutes: number | null;
  }>;
}

export interface GeneralBookingConfig {
  organizationName: string;
  organizationSlug: string;
  organizationLogo: string | null;
  /** Venue address shown in the cart panel header (optional on the wire). */
  organizationAddress?: string | null;
  /** Business time zone — the wizard renders every slot/time in this. */
  timezone?: string | null;
  /** Cancellation-policy inputs for the Confirm step's info box. */
  reschedulingNoticeRequiredHours?: number | null;
  noShowOrLateCancelFeeCents?: number | null;
  /** Org-level payment defaults, as resolver INPUT (never a pre-computed sum). */
  paymentDefaults?: BookingPaymentDefaults;
  currency: { code: string; symbol: string };
  services: GeneralBookingConfigService[];
  practitioners?: Array<{
    id: string;
    name: string;
    photo: string | null;
    title: string | null;
    serviceIds: string[];
  }>;
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

export interface GeneralBookingResult {
  leadId: string;
  appointmentId: string;
  appointmentStartTime: string;
  appointmentEndTime: string;
  /**
   * Set when a Stripe checkout session was created for what is owed. The
   * booking is created regardless; this surfaces the "Pay X" call-to-action.
   * `reason` names the charge — `full` is the whole price, NOT a deposit.
   */
  deposit?: {
    amountCents: number;
    currency: string;
    checkoutUrl: string;
    reason: ResolvedBookingPayment['reason'];
  } | null;
}

export interface SubmitGeneralBookingInput {
  serviceId: string;
  /**
   * The branch this booking is for. Absent = the org's default branch.
   *
   * The server stamps the PASSED branch on the appointment, so this is the
   * field that decides which diary a Cork booking lands on. It must be the
   * same branch the config and slots calls were scoped to — the page quoted
   * that branch's prices and offered that branch's hours.
   */
  locationSlug?: string;
  serviceIds?: string[];
  serviceItems?: Array<{ serviceId: string; variantId?: string }>;
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  notes?: string;
  appointmentStartTime: Date | string;
  appointmentEndTime: Date | string;
  practitionerId?: string;
  /** Public URL of this page — the Stripe return URLs are built from it. */
  bookingPageUrl?: string;
  /**
   * Microsite attribution. `micrositeId` NEVER a host — a tenant moving from
   * `salon.borradh.io` to `salon.com` must keep one attribution history.
   * `landingUrl` is the full URL including the query string, so the server can
   * read the UTMs the ad click carried in.
   */
  micrositeId?: string;
  landingUrl?: string;
}

// ---------------------------------------------------------------------------
// Manage booking (token-authenticated, public)
// ---------------------------------------------------------------------------

/**
 * `lateFeeCents: null` means the org charges nothing — NOT zero. The UI must
 * render "free cancellation", never "€0.00 fee".
 */
export interface CancellationPolicy {
  noticeRequiredHours: number;
  isWithinFreeWindow: boolean;
  lateFeeCents: number | null;
}

/** The branch a managed booking is at (GET public/booking/:slug/manage/:token). */
export interface ManagedAppointmentLocation {
  id: string;
  /** "Dublin Branch". Null on branches nobody named — render the address. */
  name: string | null;
  /** The branch's public slug; null pre-backfill. See `canRescheduleOnline`. */
  slug: string | null;
  /** Postal address, one line per part. */
  addressLines: string[];
}

export interface ManagedAppointment {
  appointmentId: string;
  title: string;
  startDate: string;
  endDate: string;
  status: string;
  /** False once the booking is terminal (completed/cancelled/no-show). */
  isActionable: boolean;
  serviceName: string | null;
  practitionerName: string | null;
  serviceId: string | null;
  practitionerId: string | null;
  /** The BOOKED duration, not the service's current one. */
  durationMinutes: number;
  /**
   * The branch this booking is at. Optional for contract tolerance; null when
   * the appointment carries no branch, in which case NOTHING is rendered —
   * the org's primary address is not where this customer is going.
   */
  location?: ManagedAppointmentLocation | null;
  /**
   * Server's answer to "may this page open its reschedule picker?" — false
   * when there is no service to derive slots from, and false when the booking
   * names NO branch to give the slots endpoint (a branchless row at a
   * multi-branch clinic would be offered the DEFAULT branch's diary). A branch
   * with no slug is fine — the endpoint takes `slug ?? id`.
   *
   * Optional: an older API omits it and the page falls back to the previous
   * `!!serviceId` rule.
   */
  canRescheduleOnline?: boolean;
  organization: {
    name: string;
    slug: string;
    logo: string | null;
    timezone: string;
  };
  policy: CancellationPolicy;
}

export interface CancelManagedAppointmentResponse {
  appointmentId: string;
  policyAtCancellation?: CancellationPolicy;
}

export interface RescheduleManagedAppointmentResponse {
  appointmentId: string;
  startDate?: string;
  endDate?: string;
}
