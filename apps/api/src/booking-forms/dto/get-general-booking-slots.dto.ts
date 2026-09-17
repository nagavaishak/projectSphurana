import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const getGeneralBookingSlotsDtoSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  serviceId: z.string().min(1, 'Service ID is required'),
  practitionerId: z.string().optional(),
  // Optional branch. Absent = the org's default branch (pre-branch behaviour).
  locationSlug: z.string().min(1).optional(),
});

export class GetGeneralBookingSlotsDto extends createZodDto(
  getGeneralBookingSlotsDtoSchema
) {}
