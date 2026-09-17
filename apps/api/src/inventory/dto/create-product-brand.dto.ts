import { createProductBrandRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST /product-brands` body. Validated against the CANONICAL wire contract,
 * not `createProductBrandSchema.omit({ organizationId: true })` — the feature
 * schema IS that contract plus `organizationId`, so omitting it back out was a
 * round-trip that also lost `.strict()`. The controller injects
 * `organizationId` from the active-org session.
 */
export class CreateProductBrandDto extends createZodDto(
  createProductBrandRequestSchema
) {}
