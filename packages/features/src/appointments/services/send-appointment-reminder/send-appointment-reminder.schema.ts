import { z } from 'zod';

export const sendAppointmentReminderSchema = z.object({
  appointmentId: z.string().min(1),
  kind: z.enum(['24h', '1h']),
});

export type SendAppointmentReminderInput = z.input<
  typeof sendAppointmentReminderSchema
>;
