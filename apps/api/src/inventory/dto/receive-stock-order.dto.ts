import { receiveStockOrderRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST /stock-orders/:id/receive` body. Validated against the CANONICAL wire
 * contract; `stockOrderId` comes from the route param and `organizationId` from
 * the active-org session.
 */
export class ReceiveStockOrderDto extends createZodDto(
  receiveStockOrderRequestSchema
) {}
