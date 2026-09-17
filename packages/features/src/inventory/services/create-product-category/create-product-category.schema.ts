import { createProductCategoryRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for creating a product category.
 *
 * DERIVED from the canonical wire contract (`createProductCategoryRequestBase`
 * in `@borradh-workspace/contracts`) by extending the server-injected
 * `organizationId` onto it. Field rules live in the contract.
 */
export const createProductCategorySchema =
  createProductCategoryRequestBase.extend({
    organizationId: z.string().min(1),
  });

export type CreateProductCategoryInput = z.infer<
  typeof createProductCategorySchema
>;
