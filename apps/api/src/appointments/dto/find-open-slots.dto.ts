import { findOpenSlotsRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST /appointments/open-slots` body — wraps the calendar feature's
 * `checkAvailability` service.
 *
 * Validated against the CANONICAL wire contract instead of
 * `checkAvailabilitySchema.omit({ organizationId: true })`: the feature schema
 * IS this contract plus `organizationId`, so omitting it back out was a
 * round-trip that also lost `.strict()`. The controller injects
 * `organizationId` from the active-org session.
 *
 * @see packages/contracts/src/requests/appointments.ts
 */
export class FindOpenSlotsDto extends createZodDto(
  findOpenSlotsRequestSchema
) {}
