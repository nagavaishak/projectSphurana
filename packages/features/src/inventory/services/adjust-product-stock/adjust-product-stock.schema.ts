import { adjustProductStockRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for adjusting a product's stock at one location.
 *
 * DERIVED from the canonical wire contract (`adjustProductStockRequestBase` in
 * `@borradh-workspace/contracts`) by extending the server-injected context onto
 * it: `productId` and `locationId` come from the route, `organizationId` from
 * the active-org session. `quantity` is ABSOLUTE, not a delta — see the
 * contract.
 */
export const adjustProductStockSchema = adjustProductStockRequestBase.extend({
  productId: z.string().min(1),
  locationId: z.string().min(1),
  organizationId: z.string().min(1),
});

export type AdjustProductStockInput = z.infer<typeof adjustProductStockSchema>;
