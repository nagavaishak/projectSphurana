import { createAppointmentRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST /appointments` body. Validated against the CANONICAL wire contract.
 *
 * This used to be a hand-written inline `z.object` — copied from
 * `createAppointmentBaseSchema` and then edited apart from it. (That is how
 * `source` came to be missing `booking_form`: a public booking 400'd on a value
 * the service, the pgEnum and the generated contract all accepted. It is also
 * why the `services` cart was unreachable over REST — the DTO silently stripped
 * a field the service fully supports.) The contract is now the SOURCE and
 * `createAppointmentBaseSchema` is IT plus the server-injected
 * `organizationId`, so the DTO references it directly — no `.omit()`/`.extend()`
 * chain, which is what used to blow the type-instantiation budget.
 *
 * Dates arrive as ISO strings and stay strings through the DTO; the service
 * schema's `z.coerce.date()` turns them into `Date`s. `organizationId` is
 * injected by the controller from the active-org session, and `assignedToId`
 * defaults to the current user.
 */
export class CreateAppointmentDto extends createZodDto(
  createAppointmentRequestSchema
) {}
