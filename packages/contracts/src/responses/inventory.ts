/**
 * inventory response PROJECTIONS — hand-composed from generated atoms.
 *
 * Covers the products / stock / stock-order / stock-take response surface. The
 * inventory-adjacent brand / category / supplier lookups live in ./catalog.ts
 * (authored by the catalog agent) — this file owns the rest.
 *
 * Follows the proof pattern in ./leads.ts. Each response exports a schema plus
 * its `z.infer` type. Names are chosen not to collide with sibling response
 * files (esp. catalog's `productBrand*` / `productCategory*` / `supplier*`) or
 * the re-exported `*AtomSchema` names.
 */
import { z } from 'zod';
import {
  productAtomSchema,
  productStockAtomSchema,
  stockOrderAtomSchema,
  stockOrderFeeAtomSchema,
  stockOrderItemAtomSchema,
  stockTakeAtomSchema,
  stockTakeItemAtomSchema,
} from '../generated/index.js';

// ============================================================================
// PRODUCTS
// ============================================================================

/**
 * A product on the wire.
 *
 * The atom types `images` / `skus` as `z.unknown()` (the generator can't see
 * through `jsonb().$type<string[]>()`), so they are hand-narrowed here to
 * `string[] | null` to match the DB column shape. Money fields
 * (`supplyPriceCents`, `retailPriceCents`) are integer cents.
 */
export const productSchema = productAtomSchema.extend({
  images: z.array(z.string()).nullable(),
  skus: z.array(z.string()).nullable(),
});
export type Product = z.infer<typeof productSchema>;

/**
 * A listed product plus the branches that stock it.
 *
 * LIST only, mirroring `listedServiceSchema`, and EMPTY MEANS EVERY BRANCH —
 * not "stocked nowhere". Per-branch QUANTITY is `product_stock`, a different
 * thing entirely: this answers "is it sold here at all?".
 */
export const listedProductSchema = productSchema.extend({
  locationIds: z.array(z.string()),
});
export type ListedProduct = z.infer<typeof listedProductSchema>;

/** `GET /products` — the `{ items, total, limit, offset }` list wrapper. */
export const listProductsResponseSchema = z.object({
  items: z.array(listedProductSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export type ListProductsResponse = z.infer<typeof listProductsResponseSchema>;

// ============================================================================
// STOCK (per-location product stock)
// ============================================================================

/** A per-location product-stock row (the atom, verbatim). */
export const productStockSchema = productStockAtomSchema;
export type ProductStock = z.infer<typeof productStockSchema>;

/**
 * `GET /products/:id/stock` — a bare array of per-location stock rows for one
 * product (no wrapper).
 */
export const listProductStockResponseSchema = z.array(productStockSchema);
export type ListProductStockResponse = z.infer<
  typeof listProductStockResponseSchema
>;

// ============================================================================
// STOCK ORDERS
// ============================================================================

/** A stock order on the wire (the atom, verbatim). */
export const stockOrderSchema = stockOrderAtomSchema;
export type StockOrder = z.infer<typeof stockOrderSchema>;

/** A stock-order line item (the atom, verbatim — `unitCostCents` is cents). */
export const stockOrderItemSchema = stockOrderItemAtomSchema;
export type StockOrderItem = z.infer<typeof stockOrderItemSchema>;

/**
 * A stock-order fee (the atom, verbatim). `value` is a raw number whose meaning
 * depends on `type` (integer cents for a flat fee, whole-number percent
 * otherwise) — mirrors the flat DB row.
 */
export const stockOrderFeeSchema = stockOrderFeeAtomSchema;
export type StockOrderFee = z.infer<typeof stockOrderFeeSchema>;

/**
 * `GET /stock-orders/:id` — the detail projection: the stock order joined with
 * its expanded line items and fees.
 */
export const stockOrderWithItemsSchema = stockOrderSchema.extend({
  items: z.array(stockOrderItemSchema),
  fees: z.array(stockOrderFeeSchema),
});
export type StockOrderWithItems = z.infer<typeof stockOrderWithItemsSchema>;

/** `GET /stock-orders` — the `{ items, total, limit, offset }` list wrapper. */
export const listStockOrdersResponseSchema = z.object({
  items: z.array(stockOrderSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export type ListStockOrdersResponse = z.infer<
  typeof listStockOrdersResponseSchema
>;

// ============================================================================
// STOCK TAKES
// ============================================================================

/** A stock take on the wire (the atom, verbatim). */
export const stockTakeSchema = stockTakeAtomSchema;
export type StockTake = z.infer<typeof stockTakeSchema>;

/** A stock-take line item (the atom, verbatim). */
export const stockTakeItemSchema = stockTakeItemAtomSchema;
export type StockTakeItem = z.infer<typeof stockTakeItemSchema>;

/**
 * `GET /stock-takes/:id` — the detail projection: the stock take joined with
 * its counted line items.
 */
export const stockTakeWithItemsSchema = stockTakeSchema.extend({
  items: z.array(stockTakeItemSchema),
});
export type StockTakeWithItems = z.infer<typeof stockTakeWithItemsSchema>;

/** `GET /stock-takes` — the `{ items, total, limit, offset }` list wrapper. */
export const listStockTakesResponseSchema = z.object({
  items: z.array(stockTakeSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export type ListStockTakesResponse = z.infer<
  typeof listStockTakesResponseSchema
>;
