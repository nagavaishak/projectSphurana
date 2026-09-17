import { adjustProductStockRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `PUT /products/:id/stock/:locationId` body. Validated against the CANONICAL
 * wire contract; `productId` and `locationId` come from the route params and
 * `organizationId` from the active-org session. `quantity` is ABSOLUTE, not a
 * delta.
 */
export class AdjustStockDto extends createZodDto(
  adjustProductStockRequestSchema
) {}
