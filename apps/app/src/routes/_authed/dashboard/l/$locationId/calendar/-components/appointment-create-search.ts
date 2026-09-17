import { z } from 'zod';

/**
 * Search params for the mobile create-appointment funnel
 * (`/dashboard/calendar/new/*`). Every step carries the whole set forward —
 * notably `practitionerId`, which used to be dropped on each navigation so a
 * booking made from a phone was always unassigned.
 */
export const appointmentCreateSearchSchema = z.object({
  date: z.string().optional(),
  hour: z.coerce.number().int().min(0).max(23).optional(),
  minute: z.coerce.number().int().min(0).max(59).optional(),
  leadId: z.string().optional(),
  serviceId: z.string().optional(),
  practitionerId: z.string().optional(),
});

export type AppointmentCreateSearch = z.infer<
  typeof appointmentCreateSearchSchema
>;

export function parseAppointmentSlotDate(
  search: AppointmentCreateSearch
): Date {
  if (search.date) {
    const parsed = new Date(`${search.date}T12:00:00`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date();
}
