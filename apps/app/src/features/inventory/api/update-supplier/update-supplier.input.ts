/** Typed intent for editing a supplier (name + description). */
export interface UpdateSupplierIntent {
  name: string;
  description?: string | null;
}
