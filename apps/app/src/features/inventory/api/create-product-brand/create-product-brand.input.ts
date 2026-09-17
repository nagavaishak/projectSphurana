/**
 * Typed intent for creating a product brand. Shared by BOTH surfaces: the full
 * ProductBrandDialog (name + description) and the inline-create affordance on
 * the product form's brand picker (name only). Both route through
 * `useCreateProductBrand` → one builder, so they cannot diverge.
 */
export interface CreateProductBrandIntent {
  name: string;
  description?: string | null;
}
