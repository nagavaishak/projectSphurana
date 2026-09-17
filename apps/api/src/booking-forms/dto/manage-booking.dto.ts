import {
  cancelManagedAppointmentSchema,
  rescheduleManagedAppointmentSchema,
} from '@borradh-workspace/features/appointments';
import { createZodDto } from 'nestjs-zod';

// organizationSlug and token come from the route params, not the body.
export class CancelManagedAppointmentDto extends createZodDto(
  cancelManagedAppointmentSchema.omit({ organizationSlug: true, token: true })
) {}

export class RescheduleManagedAppointmentDto extends createZodDto(
  rescheduleManagedAppointmentSchema.omit({
    organizationSlug: true,
    token: true,
  })
) {}
