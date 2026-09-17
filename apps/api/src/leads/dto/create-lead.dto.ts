import { createLeadRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST /leads` body. Validated against the CANONICAL wire contract, not
 * `createLeadSchema.omit({ organizationId: true })` — the feature schema IS
 * that contract plus `organizationId`, so omitting it back out was a round-trip
 * that also lost `.strict()`. The controller injects `organizationId` from the
 * active-org session.
 */
export class CreateLeadDto extends createZodDto(createLeadRequestSchema) {}
