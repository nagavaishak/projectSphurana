import { createProductRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST /products` body. Validated against the CANONICAL wire contract; the
 * controller injects `organizationId` from the active-org session. The
 * contract's `.default(…)`s still apply, so an omitted `measureUnit` arrives as
 * `'whole'` exactly as before.
 */
export class CreateProductDto extends createZodDto(
  createProductRequestSchema
) {}
