import { z } from 'zod';

export const getAppointmentSchema = z.object({
  id: z.string().min(1, 'Appointment ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GetAppointmentInput = z.infer<typeof getAppointmentSchema>;
