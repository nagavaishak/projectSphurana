import { setSaleClientRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `PUT /sales/:id/client` body. Validated against the CANONICAL wire contract:
 * `leadId` is nullable (send `null` to clear the client) but not optional.
 */
export class SetSaleClientDto extends createZodDto(
  setSaleClientRequestSchema
) {}
