import { createProductCategoryRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST /product-categories` body. Validated against the CANONICAL wire
 * contract; the controller injects `organizationId` from the active-org
 * session.
 */
export class CreateProductCategoryDto extends createZodDto(
  createProductCategoryRequestSchema
) {}
