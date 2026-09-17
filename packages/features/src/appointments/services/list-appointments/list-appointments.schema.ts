import { appointmentStatusValues } from '@borradh-workspace/labels';
import { z } from 'zod';

export const listAppointmentsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  leadId: z.string().optional(),
  /**
   * Branch filter. Supplied by the API from the validated `X-Location-Id`
   * header, never by the client directly. Absent = every branch, which is the
   * behaviour this endpoint had before locations existed.
   */
  locationId: z.string().min(1).optional(),
  assignedToId: z.string().optional(),
  status: z.enum(appointmentStatusValues).optional(),
  startDateFrom: z.coerce.date().optional(),
  startDateTo: z.coerce.date().optional(),
  limit: z.coerce.number().min(1).max(500).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
  /**
   * When set, restrict results to appointments "owned" by this user:
   * either directly assigned to them (`assignedToId`) OR booked against the
   * practitioner record linked to them (`practitionerId` → practitioner whose
   * `userId` matches). Used to enforce the `appointments:view_own` permission
   * for `member`-role staff. Callers with `appointments:view_all` (admin/owner)
   * must leave this unset to see the whole org's calendar.
   */
  scopeToUserId: z.string().optional(),
});

// Input type (what callers provide - accepts Date or string for dates)
export type ListAppointmentsInput = z.input<typeof listAppointmentsSchema>;

// Output type (after parsing - dates are Date objects)
export type ListAppointmentsParsed = z.output<typeof listAppointmentsSchema>;
