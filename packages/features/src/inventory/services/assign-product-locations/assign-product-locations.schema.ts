import { assignEntityLocationsRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for replacing which branches stocked a product.
 *
 * DERIVED from the canonical wire contract
 * (`assignEntityLocationsRequestBase` in `@borradh-workspace/contracts`) by
 * extending the server-injected context: `productId` is the route param and
 * `organizationId` comes from the session.
 *
 * A bare id list rather than the assignment objects services use, because
 * `product_location` has no override columns — see the contract.
 */
export const assignProductLocationsSchema =
  assignEntityLocationsRequestBase.extend({
    productId: z.string().min(1, 'Product ID is required'),
    organizationId: z.string().min(1, 'Organization ID is required'),
  });

export type AssignProductLocationsInput = z.infer<
  typeof assignProductLocationsSchema
>;
