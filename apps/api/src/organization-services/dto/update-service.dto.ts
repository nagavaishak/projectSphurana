import { updateServiceRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `PUT /organization-services/:id` body. Validated against the CANONICAL wire
 * contract — `id` is the route param and `organizationId` comes from the
 * active-org session, so neither is a body key.
 */
export class UpdateServiceDto extends createZodDto(
  updateServiceRequestSchema
) {}
