import { z } from 'zod';

export const cancelPatientBookingSchema = z.object({
  /** The signed-in patient's lead.id — from the VALIDATED session, never the client. */
  leadId: z.string().min(1, 'Lead ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  appointmentId: z.string().min(1, 'Appointment ID is required'),
  /** Optional free-text the patient gives back to the clinic. */
  reason: z.string().max(500).optional(),
});

export type CancelPatientBookingInput = z.infer<
  typeof cancelPatientBookingSchema
>;
