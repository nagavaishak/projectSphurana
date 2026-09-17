/**
 * inventory request CONTRACTS — the canonical, strict Zod schema for the BODY
 * of each inventory write endpoint (products, product brands, product
 * categories, suppliers, stock orders, stock takes, stock adjustments).
 *
 * A request contract is the wire-shaped twin of a response projection: it
 * describes exactly what the client is allowed to POST/PUT, written here in
 * pure Zod so it stays frontend-safe (no drizzle / database in the runtime
 * graph — see index.ts).
 *
 * DIRECTION OF DERIVATION — wire -> server
 * ---------------------------------------
 * This file is the SOURCE. The feature schemas under
 * `packages/features/src/inventory/services/**` DERIVE from it by `.extend()`ing
 * their server-injected context fields onto the exported base, e.g.
 *
 *     createProductSchema = createProductRequestBase.extend({ organizationId })
 *
 * Because the server schema literally IS the wire schema plus fields, it can
 * never be laxer than the wire schema, and no drift is possible. Do NOT invert
 * this — a contract hand-copied from a feature schema is exactly the drift this
 * package exists to eliminate.
 *
 * BASE vs SCHEMA — why two exports
 * --------------------------------
 * `.refine()` returns a `ZodEffects`, which has NO `.extend()`. So every
 * contract exports a matched pair:
 *
 *  - `<name>RequestBase`   — a plain `z.object({…})`. EXTENDABLE. This is what
 *    the backend feature schema extends with its context fields. It is NOT
 *    strict, because `.strict()` would reject the very fields being added.
 *  - `<name>RequestSchema` — `<name>RequestBase.strict()`. This is what
 *    VALIDATES a wire body: unknown fields are REJECTED, so a client sending a
 *    stale, renamed, or typo'd key fails loudly instead of having it silently
 *    stripped by a permissive `z.object`.
 *
 * ENUMS come from `@borradh-workspace/labels`, never from
 * `@borradh-workspace/database` (which these feature schemas used to import)
 * and never from `api-client`. The labels package is the pure-TypeScript source
 * of truth for these enums; pulling them from drizzle would drag the database
 * into every frontend bundle that touches a contract.
 *
 * Context fields the SERVER injects are absent from every body contract:
 *  - `organizationId` — from the active-org session.
 *  - `createdById`    — from the authenticated user (stock orders).
 *  - route-param ids  — `id`, `productId`, `locationId`, `stockOrderId`,
 *    `stockTakeId` — taken from the URL, never from the body.
 */
import {
  productMeasureUnitValues,
  stockOrderFeeTypeValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* Product brands                                                             */
/* -------------------------------------------------------------------------- */

/**
 * `POST /product-brands` body — the EXTENDABLE half.
 *
 * `description` is `.nullable().optional()`: the frontend's inline "Create …"
 * picker has no description input at all and coalesces the absent value to
 * `null`, while the full dialog sends a trimmed string or `null`. Both shapes
 * are legal here, and the server sees exactly the same rule.
 */
export const createProductBrandRequestBase = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().nullable().optional(),
});

/**
 * `POST /product-brands` body — the VALIDATING half. Use this wherever a body
 * is parsed (API DTO, frontend payload builder). Unknown keys are rejected, so
 * `organizationId` in a body is an error rather than a silently-ignored field.
 */
export const createProductBrandRequestSchema =
  createProductBrandRequestBase.strict();

export type CreateProductBrandRequest = z.infer<
  typeof createProductBrandRequestSchema
>;

/* -------------------------------------------------------------------------- */
/* Product categories                                                         */
/* -------------------------------------------------------------------------- */

/** `POST /product-categories` body — the EXTENDABLE half. Name only. */
export const createProductCategoryRequestBase = z.object({
  name: z.string().min(1, 'Name is required'),
});

/** `POST /product-categories` body — the VALIDATING half. */
export const createProductCategoryRequestSchema =
  createProductCategoryRequestBase.strict();

export type CreateProductCategoryRequest = z.infer<
  typeof createProductCategoryRequestSchema
>;

/* -------------------------------------------------------------------------- */
/* Suppliers                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * `POST /suppliers` body — the EXTENDABLE half. Field-for-field identical to
 * {@link createProductBrandRequestBase}, but deliberately a separate object:
 * suppliers and brands are separate endpoints whose shapes are free to diverge,
 * and aliasing one to the other would make that divergence a breaking change in
 * an unrelated domain.
 */
export const createSupplierRequestBase = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().nullable().optional(),
});

/** `POST /suppliers` body — the VALIDATING half. */
export const createSupplierRequestSchema = createSupplierRequestBase.strict();

export type CreateSupplierRequest = z.infer<typeof createSupplierRequestSchema>;

/* -------------------------------------------------------------------------- */
/* Products                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * `POST /products` body — the EXTENDABLE half.
 *
 * UNITS (checked against the server, which stores exactly these):
 *  - `supplyPriceCents` / `retailPriceCents` are integer MINOR units (cents) in
 *    the organization's currency. The form's major-unit text is converted by
 *    `parseMajorToCents` in the payload builder — the wire never carries a
 *    price string or a major-unit float.
 *  - `measureAmount` is a POSITIVE float in `measureUnit`s (e.g. `100` with
 *    `measureUnit: 'ml'`). It is the only non-integer numeric here.
 *  - `lowStockLevel` is an integer count (`>= 0`); `reorderQuantity` is an
 *    integer count (`>= 1`) — a reorder of zero units is meaningless, which is
 *    why the two minimums differ.
 *
 * The `.default(…)`s MATERIALISE into the parsed body: a caller who omits
 * `measureUnit` gets `'whole'`, and `retailEnabled` / `trackStock` /
 * `lowStockNotify` / `teamMemberCommissionEnabled` all appear as `false`. They
 * live here rather than in the feature schema because the feature schema IS
 * this object — removing a default to tidy the wire shape would silently change
 * SERVER behaviour.
 *
 * `images` carries CANONICAL media URLs only, never signed URLs (a signed URL
 * persisted into a product row expires and 403s later).
 */
export const createProductRequestBase = z.object({
  name: z.string().min(1, 'Name is required'),
  // Canonical media URLs only — never signed URLs
  images: z.array(z.string().min(1)).optional(),
  barcode: z.string().min(1).nullable().optional(),
  brandId: z.string().min(1).nullable().optional(),
  measureUnit: z.enum(productMeasureUnitValues).default('whole'),
  measureAmount: z.number().positive().nullable().optional(),
  shortDescription: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  categoryId: z.string().min(1).nullable().optional(),
  supplyPriceCents: z.number().int().min(0).nullable().optional(),
  retailEnabled: z.boolean().default(false),
  /**
   * A medication is consumed in treatment and never sold. The database
   * enforces this (product_medication_never_sold) — these defaults keep an
   * older client from posting a body it will refuse.
   */
  isMedication: z.boolean().default(false),
  onlineEnabled: z.boolean().default(false),
  shippable: z.boolean().default(true),
  // Markup is UI-computed from supply/retail price, NOT stored
  retailPriceCents: z.number().int().min(0).nullable().optional(),
  // Null means use the connected Stripe account's preset tax code.
  taxCode: z.string().min(1).nullable().optional(),
  teamMemberCommissionEnabled: z.boolean().default(false),
  skus: z.array(z.string().min(1)).optional(),
  supplierId: z.string().min(1).nullable().optional(),
  trackStock: z.boolean().default(false),
  lowStockLevel: z.number().int().min(0).nullable().optional(),
  reorderQuantity: z.number().int().min(1).nullable().optional(),
  lowStockNotify: z.boolean().default(false),
});

/**
 * `POST /products` body — the VALIDATING half.
 *
 * This is also the schema the frontend's single product payload builder parses
 * for BOTH create and update, because a create-valid body is by construction
 * update-valid: {@link updateProductRequestBase} is strictly looser (every
 * field optional, `images`/`skus` additionally nullable) apart from `isActive`,
 * which no form surface sends. Validating the writer against the tighter of the
 * two means an update can never carry a body the create endpoint would reject.
 */
export const createProductRequestSchema = createProductRequestBase.strict();

export type CreateProductRequest = z.infer<typeof createProductRequestSchema>;

/**
 * `PUT /products/:id` body — the EXTENDABLE half.
 *
 * A partial update: every field is optional, and the collection fields
 * (`images`, `skus`) are additionally nullable so a caller can CLEAR them
 * rather than merely leave them alone. `id` is a route param and is absent
 * here; the feature schema adds it back alongside `organizationId`.
 *
 * `isActive` exists only on update — a product is created active, and
 * deactivation is a later edit.
 */
export const updateProductRequestBase = z.object({
  name: z.string().min(1).optional(),
  images: z.array(z.string().min(1)).nullable().optional(),
  barcode: z.string().min(1).nullable().optional(),
  brandId: z.string().min(1).nullable().optional(),
  measureUnit: z.enum(productMeasureUnitValues).optional(),
  measureAmount: z.number().positive().nullable().optional(),
  shortDescription: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  categoryId: z.string().min(1).nullable().optional(),
  supplyPriceCents: z.number().int().min(0).nullable().optional(),
  retailEnabled: z.boolean().optional(),
  isMedication: z.boolean().optional(),
  onlineEnabled: z.boolean().optional(),
  shippable: z.boolean().optional(),
  retailPriceCents: z.number().int().min(0).nullable().optional(),
  taxCode: z.string().min(1).nullable().optional(),
  teamMemberCommissionEnabled: z.boolean().optional(),
  skus: z.array(z.string().min(1)).nullable().optional(),
  supplierId: z.string().min(1).nullable().optional(),
  trackStock: z.boolean().optional(),
  lowStockLevel: z.number().int().min(0).nullable().optional(),
  reorderQuantity: z.number().int().min(1).nullable().optional(),
  lowStockNotify: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

/** `PUT /products/:id` body — the VALIDATING half. */
export const updateProductRequestSchema = updateProductRequestBase.strict();

export type UpdateProductRequest = z.infer<typeof updateProductRequestSchema>;

/* -------------------------------------------------------------------------- */
/* Stock adjustment                                                           */
/* -------------------------------------------------------------------------- */

/**
 * `PUT /products/:id/stock/:locationId` body — the EXTENDABLE half.
 *
 * `quantity` is the ABSOLUTE on-hand count for this product at this location,
 * not a delta — the opposite convention from
 * {@link receiveStockOrderRequestBase}, whose quantities ARE deltas. Both are
 * spelled out because the two are one word apart and a mix-up silently
 * corrupts stock levels rather than erroring.
 *
 * `productId` and `locationId` are route params and are absent from the body;
 * the feature schema adds them back with `organizationId`.
 */
export const adjustProductStockRequestBase = z.object({
  // Absolute quantity for this product at this location
  quantity: z.number().int().min(0),
});

/** `PUT /products/:id/stock/:locationId` body — the VALIDATING half. */
export const adjustProductStockRequestSchema =
  adjustProductStockRequestBase.strict();

export type AdjustProductStockRequest = z.infer<
  typeof adjustProductStockRequestSchema
>;

/* -------------------------------------------------------------------------- */
/* Stock orders                                                               */
/* -------------------------------------------------------------------------- */

/**
 * One line item on a `POST /stock-orders` body.
 *
 * `quantity` is a whole number of units (`>= 1` — a zero-unit line is not an
 * order line, it is an omission). `unitCostCents` is the per-unit cost in
 * integer MINOR units, defaulting to `0` so a draft order can be placed before
 * costs are known; like every default here it materialises into the parsed
 * body.
 */
export const stockOrderItemRequestSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1),
  unitCostCents: z.number().int().min(0).default(0),
});

/**
 * One fee on a `POST /stock-orders` body.
 *
 * `value` is UNIT-POLYMORPHIC and is the most error-prone field in this domain:
 * it is CENTS when `type === 'currency'`, and BASIS POINTS when
 * `type === 'percent'` (250 = 2.5%). Both are non-negative integers, so a
 * caller that sends `2.5` for a percent fee does not get a validation error —
 * it gets a silently-wrong 0.025% fee. The frontend builder converts with
 * `Math.round(percent * 100)`; the server reads the same convention.
 */
export const stockOrderFeeRequestSchema = z.object({
  name: z.string().min(1),
  type: z.enum(stockOrderFeeTypeValues),
  // Cents when type='currency', basis points (250 = 2.5%) when type='percent'
  value: z.number().int().min(0),
});

/**
 * `POST /stock-orders` body — the EXTENDABLE half.
 *
 * `expectedByDate` is `z.coerce.date()`, so it accepts both the `Date` the
 * frontend builder holds and the ISO string that survives JSON serialisation on
 * the wire. Everything else is a plain wire value.
 *
 * `createdById` is NOT here: the API controller takes it from the authenticated
 * user, and the feature schema extends it back on alongside `organizationId`.
 */
export const createStockOrderRequestBase = z.object({
  supplierId: z.string().min(1).nullable().optional(),
  locationId: z.string().min(1).nullable().optional(),
  expectedByDate: z.coerce.date().nullable().optional(),
  notes: z.string().nullable().optional(),
  items: z
    .array(stockOrderItemRequestSchema)
    .min(1, 'At least one item is required'),
  fees: z.array(stockOrderFeeRequestSchema).default([]),
});

/** `POST /stock-orders` body — the VALIDATING half. */
export const createStockOrderRequestSchema =
  createStockOrderRequestBase.strict();

export type CreateStockOrderRequest = z.infer<
  typeof createStockOrderRequestSchema
>;

/**
 * `POST /stock-orders/:id/receive` body — the EXTENDABLE half.
 *
 * `receivedQuantity` is the DELTA received in THIS receipt event, not the
 * cumulative total received so far — sending a cumulative total double-counts
 * every previous partial receipt. Contrast
 * {@link adjustProductStockRequestBase}, whose `quantity` is absolute.
 *
 * `stockOrderId` is a route param and is absent from the body.
 */
export const receiveStockOrderRequestBase = z.object({
  // Quantities received in THIS receipt event (deltas, not cumulative totals)
  items: z
    .array(
      z.object({
        itemId: z.string().min(1),
        receivedQuantity: z.number().int().min(0),
      })
    )
    .min(1, 'At least one item is required'),
});

/** `POST /stock-orders/:id/receive` body — the VALIDATING half. */
export const receiveStockOrderRequestSchema =
  receiveStockOrderRequestBase.strict();

export type ReceiveStockOrderRequest = z.infer<
  typeof receiveStockOrderRequestSchema
>;

/* -------------------------------------------------------------------------- */
/* Stock takes                                                                */
/* -------------------------------------------------------------------------- */

/**
 * `PUT /stock-takes/:id/items` body — the EXTENDABLE half.
 *
 * `countedQuantity` is the ABSOLUTE physical count for that stock-take line,
 * which is what makes `0` meaningful and required rather than an omission: "we
 * counted none" is a real, actionable result, so the minimum is `0` and not `1`.
 *
 * The array itself must be non-empty — a stock take that records no counts at
 * all is a no-op the caller almost certainly did not intend. The frontend
 * builder drops blank/invalid draft rows, so an all-blank form hits this rule.
 *
 * `stockTakeId` is a route param and is absent from the body.
 */
export const recordStockTakeCountsRequestBase = z.object({
  items: z
    .array(
      z.object({
        itemId: z.string().min(1),
        countedQuantity: z.number().int().min(0),
      })
    )
    .min(1, 'At least one count is required'),
});

/** `PUT /stock-takes/:id/items` body — the VALIDATING half. */
export const recordStockTakeCountsRequestSchema =
  recordStockTakeCountsRequestBase.strict();

export type RecordStockTakeCountsRequest = z.infer<
  typeof recordStockTakeCountsRequestSchema
>;
