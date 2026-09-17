import { z } from 'zod';

export const rescheduleManagedAppointmentSchema = z.object({
  organizationSlug: z.string().min(1),
  token: z.string().min(1),
  /** The new start. Must be one of the slots the booking page is offering. */
  startDate: z.coerce.date(),
});

export type RescheduleManagedAppointmentInput = z.infer<
  typeof rescheduleManagedAppointmentSchema
>;
