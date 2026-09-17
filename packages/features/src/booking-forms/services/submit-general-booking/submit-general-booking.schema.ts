import { z } from 'zod';

export const submitGeneralBookingSchema = z.object({
  organizationSlug: z.string().min(1, 'Organization slug is required'),
  // The branch this booking is FOR. Absent = the org's DEFAULT branch, which
  // is what every booking got before branches existed — so a single-location
  // org, and any caller not yet passing a branch, is unchanged.
  locationSlug: z.string().min(1).optional(),
  serviceId: z.string().min(1, 'Service ID is required'),
  // Optional multi-service "cart" (Fresha). The single `serviceId` above stays
  // the primary line and keeps working on its own; when `serviceIds` is present
  // each id is snapshotted into an `appointment_service` line item and the
  // appointment duration is set to the sum of the cart's service durations.
  serviceIds: z.array(z.string().min(1)).optional(),
  // Richer alternative to `serviceIds`: each cart entry may name a chosen
  // variant. When present it takes precedence over `serviceIds`; the server
  // snapshots the VARIANT's price/duration/name into the line item (never trusts
  // a client-sent price). Back-compat: omit it and `serviceIds` behaves as before.
  serviceItems: z
    .array(
      z.object({
        serviceId: z.string().min(1),
        variantId: z.string().min(1).optional(),
      })
    )
    .optional(),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().optional(),
  email: z.string().email('Invalid email').optional(),
  phone: z.string().optional(),
  notes: z.string().optional(),
  appointmentStartTime: z.coerce.date(),
  appointmentEndTime: z.coerce.date(),
  practitionerId: z.string().optional(),
  // Public URL of the booking page the client is on. When the clinic requires
  // a deposit we use this to build the Stripe checkout success/cancel return
  // URLs (`?deposit=success` / `?deposit=cancelled`). If omitted, the deposit
  // step is skipped (we have nowhere to return the client to).
  bookingPageUrl: z.string().url().optional(),
  /**
   * MICROSITE ATTRIBUTION (plan §9, §11) — carried from the browser so the lead
   * this booking creates can be joined back to the ad that paid for it.
   *
   * `micrositeId`, NEVER the host: a tenant moving from `salon.borradh.io` to
   * `salon.com` must keep one attribution history. `landingUrl` is the full URL
   * the visitor was on, UTMs and all; `attachLeadAttribution` parses the five
   * params out of it. Both optional — a direct booking has neither, and the
   * booking must succeed exactly as before when they are absent.
   */
  micrositeId: z.string().min(1).optional(),
  landingUrl: z.string().min(1).optional(),
});

export type SubmitGeneralBookingInput = z.infer<
  typeof submitGeneralBookingSchema
>;
