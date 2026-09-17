import { receiveStockOrderRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';
import type { ReceiveStockOrderIntent } from './receive-stock-order.input';

/**
 * The single wire body for POST /stock-orders/:id/receive. Quantities are the
 * DELTAS received in this event, not cumulative totals.
 *
 * The schema is NOT declared here — it is the canonical
 * {@link receiveStockOrderRequestSchema} from `@borradh-workspace/contracts`,
 * the same object the backend's `receiveStockOrderSchema` extends with
 * `stockOrderId` + `organizationId` and the API DTO validates against. It is
 * `.strict()`, so an extra field is a parse error.
 *
 * NOTE the contract requires at least one item: the builder drops zero-quantity
 * rows, so a receive form where nothing was entered now throws here instead of
 * round-tripping to a server 400.
 */
export const receiveStockOrderBodySchema = receiveStockOrderRequestSchema;

export type ReceiveStockOrderBody = z.infer<typeof receiveStockOrderBodySchema>;

/**
 * Assemble the receive wire body from raw drafts. This is the ONLY place the
 * body is built: each draft quantity is parsed (blank/NaN → 0) and rows with a
 * zero received quantity are dropped.
 */
export function buildReceiveStockOrderPayload(
  intent: ReceiveStockOrderIntent
): ReceiveStockOrderBody {
  const items = intent.itemDrafts
    .map((draft) => ({
      itemId: draft.itemId,
      receivedQuantity: Number.parseInt(draft.rawQuantity, 10) || 0,
    }))
    .filter((i) => i.receivedQuantity > 0);

  return receiveStockOrderBodySchema.parse({ items });
}
