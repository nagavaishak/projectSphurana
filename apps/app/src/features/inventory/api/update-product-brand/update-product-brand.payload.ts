import {
  type CreateProductBrandBody,
  buildCreateProductBrandPayload,
} from '../create-product-brand/create-product-brand.payload';
import type { UpdateProductBrandIntent } from './update-product-brand.input';

/** The update wire body is identical in shape to the create body. */
export type UpdateProductBrandBody = CreateProductBrandBody;

/** Assemble the brand update wire body — the single build site. */
export function buildUpdateProductBrandPayload(
  intent: UpdateProductBrandIntent
): UpdateProductBrandBody {
  return buildCreateProductBrandPayload(intent);
}
