import { updateProductRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `PUT /products/:id` body. Validated against the CANONICAL wire contract; the
 * controller injects `id` from the route param and `organizationId` from the
 * active-org session.
 */
export class UpdateProductDto extends createZodDto(
  updateProductRequestSchema
) {}
