/** Typed intent for editing a product brand (name + description). */
export interface UpdateProductBrandIntent {
  name: string;
  description?: string | null;
}
