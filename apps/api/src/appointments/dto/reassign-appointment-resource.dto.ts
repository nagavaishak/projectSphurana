import { reassignAppointmentResourceSchema } from '@borradh-workspace/features/resources';
import { createZodDto } from 'nestjs-zod';

/**
 * Body for `PUT /appointments/:id/resources`.
 *
 * `organizationId` comes from the session and `appointmentId` from the route,
 * so both are omitted from the wire shape.
 */
export class ReassignAppointmentResourceDto extends createZodDto(
  reassignAppointmentResourceSchema.omit({
    organizationId: true,
    appointmentId: true,
  })
) {}
