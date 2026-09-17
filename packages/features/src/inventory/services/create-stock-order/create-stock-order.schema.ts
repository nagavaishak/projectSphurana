import {
  createStockOrderRequestBase,
  stockOrderFeeRequestSchema,
  stockOrderItemRequestSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Line-item and fee shapes for a stock order. These are re-exports of the
 * canonical wire contracts, kept under their historical names so existing
 * imports keep working. The unit conventions (`unitCostCents` in cents, fee
 * `value` in cents OR basis points depending on `type`) are documented on the
 * contracts themselves.
 */
export const stockOrderItemInputSchema = stockOrderItemRequestSchema;
export const stockOrderFeeInputSchema = stockOrderFeeRequestSchema;

/**
 * Schema for creating a stock order.
 *
 * DERIVED from the canonical wire contract (`createStockOrderRequestBase` in
 * `@borradh-workspace/contracts`) by extending the server-injected context onto
 * it: `organizationId` from the active-org session and `createdById` from the
 * authenticated user. Field rules — including `fees` defaulting to `[]` — live
 * in the contract.
 *
 * The contract previously imported `stockOrderFeeTypeValues` from
 * `@borradh-workspace/database`; it now comes from `@borradh-workspace/labels`,
 * the same values from a pure-TypeScript source of truth.
 */
export const createStockOrderSchema = createStockOrderRequestBase.extend({
  organizationId: z.string().min(1),
  createdById: z.string().min(1),
});

export type CreateStockOrderInput = z.input<typeof createStockOrderSchema>;
