/**
 * Inventory-taxonomy seed helpers.
 *
 * Insert real rows for the inventory-taxonomy integration spec (brands /
 * categories / suppliers / stock-takes) so the feature services + real SQL see
 * genuine data. These build on the shared primitives in ../harness.ts
 * (seedOrganization / seedUser / seedMember) and reuse the product/location/
 * supplier seeders from ./inventory.ts. They live here so harness.ts and the
 * products+stock seed file stay untouched.
 *
 * Tables touched directly here: `product_brand`, `product_category`,
 * `stock_take`. Stock-take ITEMS and product_stock reconciliation are created
 * through the HTTP endpoints under test, so they are not seeded here.
 *
 * `seedSupplier`, `seedLocation`, and `seedProduct` already exist in
 * ./inventory.ts — the spec imports those directly rather than re-exporting.
 */
import { randomUUID } from 'node:crypto';
import {
  db,
  productBrand,
  productCategory,
  stockTake,
} from '@borradh-workspace/database';

/**
 * Insert a `product_brand` scoped to an org. Returns its id. `name` is unique
 * per org (`product_brand_org_name_unique`), so a random suffix keeps repeated
 * seeds from colliding.
 */
export async function seedBrand(input: {
  organizationId: string;
  name?: string;
  description?: string | null;
}): Promise<string> {
  const id = `brand_${randomUUID()}`;
  await db.insert(productBrand).values({
    id,
    organizationId: input.organizationId,
    name: input.name ?? `Brand ${id}`,
    description: input.description ?? null,
  });
  return id;
}

/**
 * Insert a `product_category` scoped to an org. Returns its id. `name` is
 * unique per org (`product_category_org_name_unique`).
 */
export async function seedCategory(input: {
  organizationId: string;
  name?: string;
}): Promise<string> {
  const id = `cat_${randomUUID()}`;
  await db.insert(productCategory).values({
    id,
    organizationId: input.organizationId,
    name: input.name ?? `Category ${id}`,
  });
  return id;
}

/**
 * Insert a `stock_take` scoped to an org. Returns its id. `createdById`
 * (→ user.id) is NOT NULL; callers pass a real seeded user. `status` defaults
 * to `in_progress` at the DB level. `locationId` is nullable. Used for the
 * list org-isolation and cross-org GET-by-id assertions; the state-machine
 * flow is driven entirely through the HTTP endpoints instead.
 */
export async function seedStockTake(input: {
  organizationId: string;
  createdById: string;
  locationId?: string | null;
  name?: string;
  status?: (typeof stockTake.$inferInsert)['status'];
}): Promise<string> {
  const id = `stk_${randomUUID()}`;
  await db.insert(stockTake).values({
    id,
    organizationId: input.organizationId,
    createdById: input.createdById,
    locationId: input.locationId ?? null,
    name: input.name ?? 'Test Stock Take',
    status: input.status ?? 'in_progress',
  });
  return id;
}
