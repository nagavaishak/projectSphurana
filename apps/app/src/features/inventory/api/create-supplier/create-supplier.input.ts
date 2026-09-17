/**
 * Typed intent for creating a supplier. Shared by BOTH surfaces that create a
 * supplier: the full SupplierDialog (name + description) and the inline-create
 * affordance on the product / stock-order pickers (name only). Both pass this
 * intent to `useCreateSupplier`, which builds the one wire body — so the two
 * surfaces can never diverge.
 */
export interface CreateSupplierIntent {
  name: string;
  description?: string | null;
}
