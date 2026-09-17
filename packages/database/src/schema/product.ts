import { createId } from '@paralleldrive/cuid2';
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { joinRlsPolicy, orgRlsPolicy } from '../rls-policy.js';
import { organizationLocation } from './organization-location.js';
import { organization } from './organization.js';

// Import labels from enums (pure TypeScript)
import {
  productMeasureUnitLabels,
  productMeasureUnitValues,
} from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export { productMeasureUnitLabels, productMeasureUnitValues };
export type { ProductMeasureUnit } from '@borradh-workspace/labels';

// Database enums
export const productMeasureUnitEnum = pgEnum(
  'product_measure_unit',
  productMeasureUnitValues
);

export const productBrand = pgTable(
  'product_brand',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('product_brand_org_name_unique').on(
      table.organizationId,
      table.name
    ),
  ]
);

export const productBrandRlsPolicy = orgRlsPolicy(productBrand);

export const supplier = pgTable(
  'supplier',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('supplier_org_name_unique').on(table.organizationId, table.name),
  ]
);

export const supplierRlsPolicy = orgRlsPolicy(supplier);

export const productCategory = pgTable(
  'product_category',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('product_category_org_name_unique').on(
      table.organizationId,
      table.name
    ),
  ]
);

export const productCategoryRlsPolicy = orgRlsPolicy(productCategory);

export const product = pgTable(
  'product',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Canonical media URLs only — never signed URLs
    images: jsonb('images').$type<string[]>(),
    barcode: text('barcode'),
    brandId: text('brand_id').references(() => productBrand.id, {
      onDelete: 'set null',
    }),
    measureUnit: productMeasureUnitEnum('measure_unit')
      .notNull()
      .default('whole'),
    measureAmount: real('measure_amount'),
    shortDescription: text('short_description'),
    description: text('description'),
    categoryId: text('category_id').references(() => productCategory.id, {
      onDelete: 'set null',
    }),
    supplyPriceCents: integer('supply_price_cents'),
    retailEnabled: boolean('retail_enabled').notNull().default(false),
    /**
     * A medication is a CLASS, not a preference: stock consumed during a
     * treatment, never sold. Botulinum toxin and prescription-strength
     * topicals are prescription-only medicines — selling them online needs a
     * pharmacy licence no aesthetic clinic holds — so the unsafe combination
     * is forbidden by a CHECK constraint rather than left to a default.
     *
     * It also earns the product its `unit` and its `product_lot` children:
     * a medication is measured in Units/Vials/Syringes/ml and tracked by lot.
     */
    isMedication: boolean('is_medication').notNull().default(false),
    /**
     * Listed on the per-org storefront. Only meaningful when `retailEnabled`
     * is true — enforced, not merely documented.
     */
    onlineEnabled: boolean('online_enabled').notNull().default(false),
    /**
     * Separate from `onlineEnabled` on purpose. Aerosols, high alcohol content
     * and temperature-controlled items cannot be posted whatever the clinic
     * wants to sell, and a storefront that ignores this accepts orders it
     * cannot fulfil.
     */
    shippable: boolean('shippable').notNull().default(true),
    // Markup is UI-computed from supply/retail price, NOT stored
    retailPriceCents: integer('retail_price_cents'),
    // Stripe tax-code override. Null means use the connected account's preset.
    taxCode: text('tax_code'),
    teamMemberCommissionEnabled: boolean('team_member_commission_enabled')
      .notNull()
      .default(false),
    skus: jsonb('skus').$type<string[]>(),
    supplierId: text('supplier_id').references(() => supplier.id, {
      onDelete: 'set null',
    }),
    trackStock: boolean('track_stock').notNull().default(false),
    lowStockLevel: integer('low_stock_level'),
    reorderQuantity: integer('reorder_quantity'),
    lowStockNotify: boolean('low_stock_notify').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_product_org_id').on(table.organizationId),
    uniqueIndex('product_org_barcode_unique')
      .on(table.organizationId, table.barcode)
      .where(sql`${table.barcode} IS NOT NULL`),
    /**
     * The unsafe combinations are made UNREPRESENTABLE rather than merely
     * discouraged. Prose conventions get broken in six months; a CHECK makes
     * "prescription medicine listed on the storefront" a database error.
     */
    check(
      'product_medication_never_sold',
      sql`NOT (${table.isMedication} AND (${table.retailEnabled} OR ${table.onlineEnabled}))`
    ),
    check(
      'product_online_implies_retail',
      sql`NOT ${table.onlineEnabled} OR ${table.retailEnabled}`
    ),
  ]
);

export const productRlsPolicy = orgRlsPolicy(product);

/**
 * A lot of a medication held at a location. Batch and expiry cannot live on
 * `product` because one product has MANY lots with different expiries — and
 * for a medication this, not `product_stock`, is where quantity really lives.
 *
 * This is the traceability record: on a recall the clinic must produce every
 * patient who received a given lot, so `lot` is chosen from here when a
 * treatment is recorded rather than typed. A typo in a batch number is
 * invisible until the day it matters.
 */
export const productLot = pgTable(
  'product_lot',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    locationId: text('location_id')
      .notNull()
      .references(() => organizationLocation.id, { onDelete: 'cascade' }),
    lot: text('lot').notNull(),
    expiry: timestamp('expiry').notNull(),
    quantity: integer('quantity').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_product_lot_product_id').on(table.productId),
    unique('product_lot_unique').on(
      table.productId,
      table.locationId,
      table.lot
    ),
  ]
);

export const productLotRelations = relations(productLot, ({ one }) => ({
  product: one(product, {
    fields: [productLot.productId],
    references: [product.id],
  }),
  location: one(organizationLocation, {
    fields: [productLot.locationId],
    references: [organizationLocation.id],
  }),
}));

/**
 * Tenanted through its product, exactly as `product_stock` is: a lot has no
 * organization_id of its own, and inheriting one would be a second copy of the
 * same fact.
 */
export const productLotRlsPolicy = joinRlsPolicy(productLot, {
  parent: 'product',
  fk: 'product_id',
});

export type ProductLot = typeof productLot.$inferSelect;

export const productStock = pgTable(
  'product_stock',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    locationId: text('location_id')
      .notNull()
      .references(() => organizationLocation.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('product_stock_unique').on(table.productId, table.locationId),
    index('idx_product_stock_location_id').on(table.locationId),
  ]
);

export const productStockRlsPolicy = joinRlsPolicy(productStock, {
  parent: 'product',
  fk: 'product_id',
});

/**
 * A short-lived hold made only when a shopper starts Checkout.  The cart stays
 * in the browser; this is the server-side part that prevents two shoppers
 * paying for the last unit.
 */
export const productReservation = pgTable(
  'product_reservation',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    locationId: text('location_id')
      .notNull()
      .references(() => organizationLocation.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    // Browser-generated opaque cart id; it is not a customer identity.
    cartId: text('cart_id').notNull(),
    stripeCheckoutSessionId: text('stripe_checkout_session_id'),
    // Frozen when the hold is made: webhook finalisation must not re-read a
    // catalogue price/name that staff may have changed during Checkout.
    productName: text('product_name'),
    unitPriceCents: integer('unit_price_cents'),
    taxCode: text('tax_code'),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_product_reservation_product_location_expiry').on(
      table.productId,
      table.locationId,
      table.expiresAt
    ),
    index('idx_product_reservation_cart_id').on(table.cartId),
  ]
);

export const productReservationRlsPolicy = joinRlsPolicy(productReservation, {
  parent: 'product',
  fk: 'product_id',
});

/** A customer's one-time request to hear when a retail product is restocked. */
export const productRestockNotification = pgTable(
  'product_restock_notification',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    notifiedAt: timestamp('notified_at'),
  },
  (table) => [
    unique('product_restock_notification_product_email_unique').on(
      table.productId,
      table.email
    ),
  ]
);

export const productRestockNotificationRlsPolicy = joinRlsPolicy(
  productRestockNotification,
  { parent: 'product', fk: 'product_id' }
);

/**
 * product_location — which branches SELL a product.
 *
 * The product row stays org-level (one SKU, one brand, one supplier); this row
 * only says "sold here". Quantity is NOT here — `product_stock` continues to
 * hold the per-branch quantity, and the two are deliberately separate: a
 * branch can carry a listed product at zero stock, and a stock row can exist
 * for a product that branch no longer lists.
 *
 * ZERO rows = sold everywhere, so this lands without a backfill.
 */
export const productLocation = pgTable(
  'product_location',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    locationId: text('location_id')
      .notNull()
      .references(() => organizationLocation.id, { onDelete: 'cascade' }),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    unique('product_location_unique').on(table.productId, table.locationId),
    index('idx_product_location_location_id').on(table.locationId),
  ]
);

export const productLocationRlsPolicy = joinRlsPolicy(productLocation, {
  parent: 'product',
  fk: 'product_id',
});

export const productLocationRelations = relations(
  productLocation,
  ({ one }) => ({
    product: one(product, {
      fields: [productLocation.productId],
      references: [product.id],
    }),
    location: one(organizationLocation, {
      fields: [productLocation.locationId],
      references: [organizationLocation.id],
    }),
  })
);

export type ProductLocation = typeof productLocation.$inferSelect;
export type NewProductLocation = typeof productLocation.$inferInsert;

export const productBrandRelations = relations(
  productBrand,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [productBrand.organizationId],
      references: [organization.id],
    }),
    products: many(product),
  })
);

export const supplierRelations = relations(supplier, ({ one, many }) => ({
  organization: one(organization, {
    fields: [supplier.organizationId],
    references: [organization.id],
  }),
  products: many(product),
}));

export const productCategoryRelations = relations(
  productCategory,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [productCategory.organizationId],
      references: [organization.id],
    }),
    products: many(product),
  })
);

export const productRelations = relations(product, ({ one, many }) => ({
  organization: one(organization, {
    fields: [product.organizationId],
    references: [organization.id],
  }),
  brand: one(productBrand, {
    fields: [product.brandId],
    references: [productBrand.id],
  }),
  category: one(productCategory, {
    fields: [product.categoryId],
    references: [productCategory.id],
  }),
  supplier: one(supplier, {
    fields: [product.supplierId],
    references: [supplier.id],
  }),
  stock: many(productStock),
  productLocations: many(productLocation),
}));

export const productStockRelations = relations(productStock, ({ one }) => ({
  product: one(product, {
    fields: [productStock.productId],
    references: [product.id],
  }),
  location: one(organizationLocation, {
    fields: [productStock.locationId],
    references: [organizationLocation.id],
  }),
}));

export type ProductBrand = typeof productBrand.$inferSelect;
export type NewProductBrand = typeof productBrand.$inferInsert;
export type Supplier = typeof supplier.$inferSelect;
export type NewSupplier = typeof supplier.$inferInsert;
export type ProductCategory = typeof productCategory.$inferSelect;
export type NewProductCategory = typeof productCategory.$inferInsert;
export type Product = typeof product.$inferSelect;
export type NewProduct = typeof product.$inferInsert;
export type ProductStock = typeof productStock.$inferSelect;
export type NewProductStock = typeof productStock.$inferInsert;
