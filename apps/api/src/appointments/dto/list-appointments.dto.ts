import { appointmentStatusValues } from '@borradh-workspace/labels';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Helper to coerce date values, handling undefined/null/empty strings from query params
const optionalDateCoerce = z.preprocess((val) => {
  if (val === undefined || val === null || val === '') return undefined;
  if (val instanceof Date) return val;
  if (typeof val === 'string') {
    const parsed = new Date(val);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
}, z.date().optional());

// Define inline schema to avoid excessive type instantiation
const listAppointmentsDtoSchema = z.object({
  leadId: z.string().optional(),
  assignedToId: z.string().optional(),
  status: z.enum(appointmentStatusValues).optional(),
  startDateFrom: optionalDateCoerce,
  startDateTo: optionalDateCoerce,
  limit: z.coerce.number().min(1).max(500).default(50),
  offset: z.coerce.number().min(0).default(0),
});

export class ListAppointmentsDto extends createZodDto(
  listAppointmentsDtoSchema
) {}
