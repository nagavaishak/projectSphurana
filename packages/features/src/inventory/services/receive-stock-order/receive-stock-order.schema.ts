import { receiveStockOrderRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for receiving against a stock order.
 *
 * DERIVED from the canonical wire contract (`receiveStockOrderRequestBase` in
 * `@borradh-workspace/contracts`) by extending the server-injected context onto
 * it: `stockOrderId` from the route, `organizationId` from the active-org
 * session. Received quantities are DELTAS for this event — see the contract.
 */
export const receiveStockOrderSchema = receiveStockOrderRequestBase.extend({
  stockOrderId: z.string().min(1),
  organizationId: z.string().min(1),
});

export type ReceiveStockOrderInput = z.infer<typeof receiveStockOrderSchema>;
