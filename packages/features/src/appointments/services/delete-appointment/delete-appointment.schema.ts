import { z } from 'zod';

export const deleteAppointmentSchema = z.object({
  id: z.string().min(1, 'Appointment ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  actorId: z.string().optional(),
});

export type DeleteAppointmentInput = z.infer<typeof deleteAppointmentSchema>;
