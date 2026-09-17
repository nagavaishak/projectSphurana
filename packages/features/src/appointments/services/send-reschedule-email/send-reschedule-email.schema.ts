import { z } from 'zod';

export const sendRescheduleEmailSchema = z.object({
  appointmentId: z.string().min(1, 'Appointment ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  oldStartDate: z.coerce.date(),
  oldEndDate: z.coerce.date(),
  customMessage: z.string().optional(),
});

export type SendRescheduleEmailInput = z.infer<
  typeof sendRescheduleEmailSchema
>;
