import { z } from 'zod';

export const notifyPractitionerCancellationSchema = z.object({
  appointmentId: z.string().min(1, 'Appointment ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  cancellationReason: z.string().optional(),
});

export type NotifyPractitionerCancellationInput = z.infer<
  typeof notifyPractitionerCancellationSchema
>;
