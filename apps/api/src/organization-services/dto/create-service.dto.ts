import { createServiceRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST /organization-services` body. Validated against the CANONICAL wire
 * contract, not `createServiceSchema.partial({ organizationId: true })` — the
 * feature schema IS that contract plus `organizationId`, so partialling it back
 * out was a round-trip that also lost `.strict()`. The controller injects
 * `organizationId` from the active-org session.
 */
export class CreateServiceDto extends createZodDto(
  createServiceRequestSchema
) {}
