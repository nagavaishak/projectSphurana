/**
 * Inventory-domain seed helpers.
 *
 * Insert real rows for the inventory (products + stock) integration spec so the
 * feature services + real SQL see genuine data. These build on the shared
 * primitives in ../harness.ts (seedOrganization / seedUser / seedMember) but
 * live here so harness.ts stays domain-agnostic.
 *
 * Tables touched: `organization_location`, `supplier`, `product`. Stock rows
 * (`product_stock`) and stock orders are created through the HTTP endpoints
 * under test (adjust-stock / create-stock-order), so they are not seeded here.
 */
import { randomUUID } from 'node:crypto';
import { db, product, supplier } from '@borradh-workspace/database';
import { seedLocation as seedHarnessLocation } from '../harness.js';

/**
 * Insert an `organization_location` scoped to an org. Returns its id.
 *
 * `addressLine1`, `city`, and `country` are NOT NULL with no default — supplied
 * here. The location is required by adjust-stock and by a stock order's
 * destination (both verify the location belongs to the caller's org before
 * writing stock).
 */
export async function seedLocation(input: {
  organizationId: string;
  name?: string;
}): Promise<string> {
  // Delegates to the shared helper. A branch is the unit of work now, so its
  // seed is not inventory-specific — and the shared one supplies COORDINATES,
  // without which anything geo (ad targeting) refuses the branch outright.
  return seedHarnessLocation({ ...input, name: input.name ?? 'Main Location' });
}

/**
 * Insert a `supplier` scoped to an org. Returns its id. `name` is unique per
 * org, so a random suffix keeps repeated seeds from colliding.
 */
export async function seedSupplier(input: {
  organizationId: string;
  name?: string;
}): Promise<string> {
  const id = `sup_${randomUUID()}`;
  await db.insert(supplier).values({
    id,
    organizationId: input.organizationId,
    name: input.name ?? `Supplier ${id}`,
  });
  return id;
}

/**
 * Insert a `product` scoped to an org. Returns its id. Only `organizationId`
 * and `name` are required; everything else defaults at the DB/schema level.
 * Pass `trackStock` when the test asserts stock accounting.
 */
export async function seedProduct(input: {
  organizationId: string;
  name?: string;
  trackStock?: boolean;
  brandId?: string;
  categoryId?: string;
  supplierId?: string;
}): Promise<string> {
  const id = `prod_${randomUUID()}`;
  await db.insert(product).values({
    id,
    organizationId: input.organizationId,
    name: input.name ?? 'Test Product',
    trackStock: input.trackStock ?? false,
    brandId: input.brandId ?? null,
    categoryId: input.categoryId ?? null,
    supplierId: input.supplierId ?? null,
  });
  return id;
}
