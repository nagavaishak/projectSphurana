import { recordStockTakeCountsRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for recording stock-take counts.
 *
 * DERIVED from the canonical wire contract
 * (`recordStockTakeCountsRequestBase` in `@borradh-workspace/contracts`) by
 * extending the server-injected context onto it: `stockTakeId` from the route,
 * `organizationId` from the active-org session. Counted quantities are ABSOLUTE
 * physical counts — see the contract.
 */
export const recordStockTakeCountsSchema =
  recordStockTakeCountsRequestBase.extend({
    stockTakeId: z.string().min(1),
    organizationId: z.string().min(1),
  });

export type RecordStockTakeCountsInput = z.infer<
  typeof recordStockTakeCountsSchema
>;
