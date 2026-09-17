import { recordStockTakeCountsRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';
import type { RecordStockTakeCountsIntent } from './record-stock-take-counts.input';

/**
 * The single wire body for PUT /stock-takes/:id/items.
 *
 * The schema is NOT declared here — it is the canonical
 * {@link recordStockTakeCountsRequestSchema} from
 * `@borradh-workspace/contracts`, the same object the backend's
 * `recordStockTakeCountsSchema` extends with `stockTakeId` + `organizationId`
 * and the API DTO validates against. It is `.strict()`, so an extra field is a
 * parse error, never a silent strip.
 *
 * NOTE the contract requires at least one count: the builder drops blank and
 * invalid draft rows, so an all-blank form now throws here instead of
 * round-tripping to a server 400.
 */
export const recordStockTakeCountsBodySchema =
  recordStockTakeCountsRequestSchema;

export type RecordStockTakeCountsBody = z.infer<
  typeof recordStockTakeCountsBodySchema
>;

/**
 * Assemble the record-counts wire body from raw drafts. This is the ONLY place
 * the body is built: each draft is parsed and rows that are blank or not a
 * valid non-negative integer are dropped.
 */
export function buildRecordStockTakeCountsPayload(
  intent: RecordStockTakeCountsIntent
): RecordStockTakeCountsBody {
  const items = intent.itemDrafts
    .map((draft) => ({
      itemId: draft.itemId,
      countedQuantity: Number.parseInt(draft.rawCount, 10),
    }))
    .filter(
      (i) => Number.isInteger(i.countedQuantity) && i.countedQuantity >= 0
    );

  return recordStockTakeCountsBodySchema.parse({ items });
}
