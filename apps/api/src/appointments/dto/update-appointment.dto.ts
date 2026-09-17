import { updateAppointmentRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `PUT /appointments/:id` body. Validated against the CANONICAL wire contract
 * rather than a hand-written mirror of `updateAppointmentBaseSchema` — the
 * feature schema IS that contract plus the route `id` and `organizationId`, so
 * there is no longer a second description to drift from.
 *
 * Dates stay ISO strings here; the service schema coerces them to `Date`s.
 */
export class UpdateAppointmentDto extends createZodDto(
  updateAppointmentRequestSchema
) {}
