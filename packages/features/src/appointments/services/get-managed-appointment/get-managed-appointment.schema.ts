import { z } from 'zod';

export const getManagedAppointmentSchema = z.object({
  organizationSlug: z.string().min(1),
  token: z.string().min(1),
});

export type GetManagedAppointmentInput = z.infer<
  typeof getManagedAppointmentSchema
>;

/** The branch a managed booking is at, as the manage-booking page renders it. */
export interface ManagedAppointmentLocation {
  id: string;
  /** "Dublin Branch". Null on branches nobody named — render the address. */
  name: string | null;
  /** The branch's public slug; null pre-backfill. See `canRescheduleOnline`. */
  slug: string | null;
  /** Postal address, one line per part, empty when nothing is on file. */
  addressLines: string[];
}

export interface ManagedAppointmentView {
  appointmentId: string;
  title: string;
  startDate: Date;
  endDate: Date;
  status: string;
  /** Terminal states cannot be cancelled or rescheduled — the UI reads this. */
  isActionable: boolean;
  serviceName: string | null;
  practitionerName: string | null;
  /**
   * Needed by the reschedule picker, which re-derives the offered slots from
   * the same public slots endpoint the booking page uses. Safe to expose: the
   * token holder is the person who booked this service.
   */
  serviceId: string | null;
  practitionerId: string | null;
  /** The BOOKED duration, not the service's current one. */
  durationMinutes: number;
  /**
   * The BRANCH this booking is at. Null when `appointment.location_id` is NULL
   * (every pre-backfill row) or names a branch that has since been deleted —
   * and null must render as NOTHING, never as the org's primary address. This
   * page is what a customer navigates from on the day.
   */
  location: ManagedAppointmentLocation | null;
  /**
   * Whether the page may offer its reschedule picker.
   *
   * The picker fills itself from the public slots endpoint, which addresses a
   * branch by `slug ?? id` — so this is false when the booking has no service
   * to derive slots from, and when the booking names NO branch at all
   * (`isBookingLocationAddressable`). A branchless row in a multi-branch org
   * would otherwise be offered the DEFAULT branch's diary, which is exactly
   * the cross-branch defect this closes. A branch with no SLUG is fine now —
   * its id names it. The server-side write gate keys on `location_id` and is
   * unaffected either way.
   */
  canRescheduleOnline: boolean;
  organization: {
    name: string;
    slug: string;
    logo: string | null;
    timezone: string;
  };
  policy: {
    noticeRequiredHours: number;
    isWithinFreeWindow: boolean;
    lateFeeCents: number | null;
  };
}
