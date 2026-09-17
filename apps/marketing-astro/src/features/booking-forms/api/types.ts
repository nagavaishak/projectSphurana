// Booking API types. Inlined here (snapshot of the backend booking-forms
// types) so the marketing app does not depend on @borradh-workspace/api-client
// — which transitively pulls in the whole backend features + database tree.

/** A single available time slot. */
export interface TimeSlot {
  startTime: string; // ISO string
  endTime: string; // ISO string
}

/** A practitioner and their available slots. */
export interface PractitionerAvailability {
  practitioner: {
    id: string;
    name: string;
    photo: string | null;
    title: string | null;
  };
  slots: TimeSlot[];
}

/** Available-slots response for a service/date. */
export interface AvailableSlotsResponse {
  slots: TimeSlot[];
  byPractitioner?: PractitionerAvailability[];
}

/** Structured price shape — mirrors `ServicePriceType` in @borradh-workspace/labels. */
export type ServicePriceType = 'fixed' | 'from' | 'free' | 'poa';

/** A customer-chosen pricing option on a service. */
export interface ServiceVariant {
  id: string;
  name: string;
  priceCents: number | null;
  durationMinutes: number | null;
}

/** General booking page configuration (org info + services list). */
export interface GeneralBookingConfig {
  organizationName: string;
  organizationSlug: string;
  organizationLogo: string | null;
  /** The org's display currency ({ code, symbol }), from its country. */
  currency: { code: string; symbol: string };
  services: Array<{
    id: string;
    name: string;
    /** DEPRECATED freeform price — derive display from the structured fields. */
    pricingDescription: string | null;
    /** Structured price shape (fixed | from | free | poa). */
    priceType: ServicePriceType;
    /** Machine-readable anchor price in cents. */
    priceCents: number | null;
    appointmentDuration: number | null;
    description: string | null;
    requiresDeposit: boolean;
    depositAmountCents: number | null;
    /** Customer-chosen pricing options; empty for single-price services. */
    variants: ServiceVariant[];
  }>;
}

/** Result of submitting a general booking. */
export interface GeneralBookingResult {
  leadId: string;
  appointmentId: string;
  appointmentStartTime: string; // ISO string
  appointmentEndTime: string; // ISO string
}

/** Input for submitting a general booking (organizationSlug comes from the route). */
export interface SubmitGeneralBookingInput {
  serviceId: string;
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  notes?: string;
  appointmentStartTime: Date | string;
  appointmentEndTime: Date | string;
  practitionerId?: string;
}
