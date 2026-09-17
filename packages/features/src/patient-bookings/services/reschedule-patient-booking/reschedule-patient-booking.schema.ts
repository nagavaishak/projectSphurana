import { z } from 'zod';

export const reschedulePatientBookingSchema = z.object({
  /** The signed-in patient's lead.id — from the VALIDATED session, never the client. */
  leadId: z.string().min(1, 'Lead ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  appointmentId: z.string().min(1, 'Appointment ID is required'),
  /** The new start. Must be a slot the booking page is actually offering. */
  startTime: z.coerce.date(),
  /**
   * Accepted for API-contract symmetry but not trusted: the underlying
   * reschedule service preserves the booked duration, so the real end is
   * always derived from startTime + duration server-side.
   */
  endTime: z.coerce.date().optional(),
});

export type ReschedulePatientBookingInput = z.infer<
  typeof reschedulePatientBookingSchema
>;
