import { createProductRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for creating a product.
 *
 * DERIVED from the canonical wire contract (`createProductRequestBase` in
 * `@borradh-workspace/contracts`) by extending the server-injected
 * `organizationId` onto it. Every field rule — including the `.default(…)`s for
 * `measureUnit`, `retailEnabled`, `teamMemberCommissionEnabled`, `trackStock`
 * and `lowStockNotify` — lives in the contract, so the defaults the server
 * applies are exactly the ones the client is told about. Do not restate them
 * here.
 *
 * The contract previously imported `productMeasureUnitValues` from
 * `@borradh-workspace/database`; it now comes from `@borradh-workspace/labels`,
 * which is the same set of values from a pure-TypeScript source of truth.
 */
export const createProductSchema = createProductRequestBase.extend({
  organizationId: z.string().min(1),
});

export type CreateProductInput = z.input<typeof createProductSchema>;
