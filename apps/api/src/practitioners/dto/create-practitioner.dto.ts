import { createPractitionerRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST /practitioners` body. Validated against the CANONICAL wire contract, not
 * a `.omit()`/`.partial()` of the feature schema: the feature schema derives
 * FROM this contract, so the DTO and the service agree by construction.
 * `organizationId` comes from the active-org session and is rejected in the
 * body (the contract is `.strict()`).
 */
export class CreatePractitionerDto extends createZodDto(
  createPractitionerRequestSchema
) {}
