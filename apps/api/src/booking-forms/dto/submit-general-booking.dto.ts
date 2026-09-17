import { submitGeneralBookingSchema } from '@borradh-workspace/features/booking-forms';
import { createZodDto } from 'nestjs-zod';

export class SubmitGeneralBookingDto extends createZodDto(
  submitGeneralBookingSchema.omit({ organizationSlug: true })
) {}
