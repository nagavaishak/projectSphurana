import { updateProductRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for updating a product.
 *
 * DERIVED from the canonical wire contract (`updateProductRequestBase` in
 * `@borradh-workspace/contracts`) by extending the server-injected context onto
 * it: `organizationId` from the active-org session and `id` from the route
 * param. Field rules live in the contract.
 */
export const updateProductSchema = updateProductRequestBase.extend({
  id: z.string().min(1),
  organizationId: z.string().min(1),
});

export type UpdateProductInput = z.infer<typeof updateProductSchema>;
