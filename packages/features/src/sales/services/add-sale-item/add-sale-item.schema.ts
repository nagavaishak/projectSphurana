import {
  addSaleItemRefinement,
  addSaleItemRequestBase,
} from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for adding a line to an open sale.
 *
 * DERIVED from the canonical wire contract (`addSaleItemRequestBase` in
 * `@borradh-workspace/contracts`) by extending the server-injected context onto
 * it, then applying the SAME `superRefine` callback the wire schema applies
 * (`addSaleItemRefinement`). Re-typing those cross-field rules here would be a
 * second description of the same invariant on the checkout path — the exported
 * callback exists precisely so there is only one.
 *
 * Field rules (`.min(1)`, `.int()`, `quantity`'s `.default(1)`) live in the
 * contract; do not restate them here.
 */
export const addSaleItemSchema = addSaleItemRequestBase
  .extend({
    organizationId: z.string().min(1),
    saleId: z.string().min(1),
  })
  .superRefine(addSaleItemRefinement);

export type AddSaleItemInput = z.input<typeof addSaleItemSchema>;
