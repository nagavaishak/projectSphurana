import { z } from 'zod';

export const cancelManagedAppointmentSchema = z.object({
  organizationSlug: z.string().min(1),
  token: z.string().min(1),
  /** Optional free-text the patient gives back to the clinic. */
  reason: z.string().max(500).optional(),
});

export type CancelManagedAppointmentInput = z.infer<
  typeof cancelManagedAppointmentSchema
>;
