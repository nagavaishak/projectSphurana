import { addCatalogLocationsRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for ADDING branches to a product's assignments.
 *
 * DERIVED from the canonical wire contract (`addCatalogLocationsRequestBase`),
 * extended with the server-injected context: `productId` is the route param and
 * `organizationId` comes from the session.
 */
export const addProductLocationsSchema = addCatalogLocationsRequestBase.extend({
  productId: z.string().min(1, 'Product ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type AddProductLocationsInput = z.infer<
  typeof addProductLocationsSchema
>;
