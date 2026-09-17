import { z } from 'zod';

export const notifyOwnerRescheduleSchema = z.object({
  appointmentId: z.string().min(1, 'Appointment ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  /** The appointment's start BEFORE the move — the current row holds the new one. */
  oldStartDate: z.coerce.date(),
});

export type NotifyOwnerRescheduleInput = z.infer<
  typeof notifyOwnerRescheduleSchema
>;
