import { createSupplierRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST /suppliers` body. Validated against the CANONICAL wire contract; the
 * controller injects `organizationId` from the active-org session.
 */
export class CreateSupplierDto extends createZodDto(
  createSupplierRequestSchema
) {}
