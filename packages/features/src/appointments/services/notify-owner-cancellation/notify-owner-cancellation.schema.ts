import { z } from 'zod';

export const notifyOwnerCancellationSchema = z.object({
  appointmentId: z.string().min(1, 'Appointment ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  cancellationReason: z.string().max(500).optional(),
});

export type NotifyOwnerCancellationInput = z.infer<
  typeof notifyOwnerCancellationSchema
>;
