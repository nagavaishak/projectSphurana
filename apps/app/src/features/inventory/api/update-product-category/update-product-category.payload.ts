import {
  type CreateProductCategoryBody,
  buildCreateProductCategoryPayload,
} from '../create-product-category/create-product-category.payload';
import type { UpdateProductCategoryIntent } from './update-product-category.input';

/** The update wire body is identical in shape to the create body. */
export type UpdateProductCategoryBody = CreateProductCategoryBody;

/** Assemble the category update wire body — the single build site. */
export function buildUpdateProductCategoryPayload(
  intent: UpdateProductCategoryIntent
): UpdateProductCategoryBody {
  return buildCreateProductCategoryPayload(intent);
}
