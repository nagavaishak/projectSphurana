import { createProductCategoryRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';
import type { CreateProductCategoryIntent } from './create-product-category.input';

/**
 * The single wire body for POST /product-categories.
 *
 * The schema is NOT declared here — it is the canonical
 * {@link createProductCategoryRequestSchema} from
 * `@borradh-workspace/contracts`, the same object the backend's
 * `createProductCategorySchema` extends with `organizationId` and the API DTO
 * validates against. It is `.strict()`, so an extra or missing field is a
 * parse/type error, never a silent strip.
 */
export const createProductCategoryBodySchema =
  createProductCategoryRequestSchema;

export type CreateProductCategoryBody = z.infer<
  typeof createProductCategoryBodySchema
>;

/**
 * Assemble the category wire body from intent. The ONLY place a category create
 * body is built — dialog and inline-create picker both route here.
 */
export function buildCreateProductCategoryPayload(
  intent: CreateProductCategoryIntent
): CreateProductCategoryBody {
  return createProductCategoryBodySchema.parse({
    name: intent.name.trim(),
  });
}
