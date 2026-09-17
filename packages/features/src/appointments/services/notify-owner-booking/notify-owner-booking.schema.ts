import { z } from 'zod';

export const notifyOwnerBookingSchema = z.object({
  appointmentId: z.string().min(1, 'Appointment ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type NotifyOwnerBookingInput = z.infer<typeof notifyOwnerBookingSchema>;
