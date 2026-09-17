import { z } from 'zod';

export const createSubmissionsForAppointmentSchema = z.object({
  appointmentId: z.string().min(1, 'Appointment ID is required'),
  leadId: z.string().min(1, 'Lead ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  serviceId: z.string().min(1, 'Service ID is required'),
});

export type CreateSubmissionsForAppointmentInput = z.infer<
  typeof createSubmissionsForAppointmentSchema
>;
