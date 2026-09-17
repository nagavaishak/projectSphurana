import { z } from 'zod';

export const syncToCalendarSchema = z.object({
  appointmentId: z.string().min(1, 'Appointment ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  action: z.enum(['create', 'update', 'delete']),
});

export type SyncToCalendarInput = z.infer<typeof syncToCalendarSchema>;
