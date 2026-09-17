/**
 * Typed intent for creating a product category. Shared by BOTH surfaces: the
 * full ProductCategoryDialog and the inline-create affordance on the product
 * form's category picker. Both route through `useCreateProductCategory` → one
 * builder, so they cannot diverge.
 */
export interface CreateProductCategoryIntent {
  name: string;
}
