import { createStockOrderRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST /stock-orders` body. Validated against the CANONICAL wire contract; the
 * controller injects `organizationId` from the active-org session and
 * `createdById` from the authenticated user.
 */
export class CreateStockOrderDto extends createZodDto(
  createStockOrderRequestSchema
) {}
