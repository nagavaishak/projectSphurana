import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { childOrgRlsPolicy, orgRlsPolicy } from '../rls-policy.js';
import { organizationLocation } from './organization-location.js';
import { organization } from './organization.js';
import { product, supplier } from './product.js';
import { user } from './user.js';

// Import labels from enums (pure TypeScript)
import {
  stockOrderFeeTypeLabels,
  stockOrderFeeTypeValues,
  stockOrderStatusLabels,
  stockOrderStatusValues,
} from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export {
  stockOrderStatusLabels,
  stockOrderStatusValues,
  stockOrderFeeTypeLabels,
  stockOrderFeeTypeValues,
};
export type {
  StockOrderStatus,
  StockOrderFeeType,
} from '@borradh-workspace/labels';

// Database enums
export const stockOrderStatusEnum = pgEnum(
  'stock_order_status',
  stockOrderStatusValues
);
export const stockOrderFeeTypeEnum = pgEnum(
  'stock_order_fee_type',
  stockOrderFeeTypeValues
);

export const stockOrder = pgTable(
  'stock_order',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    supplierId: text('supplier_id').references(() => supplier.id, {
      onDelete: 'set null',
    }),
    // Destination location that receives the stock
    locationId: text('location_id').references(() => organizationLocation.id, {
      onDelete: 'set null',
    }),
    status: stockOrderStatusEnum('status').notNull().default('draft'),
    expectedByDate: timestamp('expected_by_date'),
    notes: text('notes'),
    createdById: text('created_by_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('idx_stock_order_org_id').on(table.organizationId)]
);

export const stockOrderRlsPolicy = orgRlsPolicy(stockOrder);

export const stockOrderItem = pgTable(
  'stock_order_item',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    stockOrderId: text('stock_order_id')
      .notNull()
      .references(() => stockOrder.id, { onDelete: 'cascade' }),
    // restrict: order history must survive — soft-deactivate products instead
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
    receivedQuantity: integer('received_quantity').notNull().default(0),
    unitCostCents: integer('unit_cost_cents').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('idx_stock_order_item_order_id').on(table.stockOrderId)]
);

export const stockOrderItemRlsPolicy = childOrgRlsPolicy(stockOrderItem, {
  parent: 'stock_order',
  fk: 'stock_order_id',
});

export const stockOrderFee = pgTable('stock_order_fee', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  stockOrderId: text('stock_order_id')
    .notNull()
    .references(() => stockOrder.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: stockOrderFeeTypeEnum('type').notNull(),
  // Cents when type='currency', basis points (250 = 2.5%) when type='percent'
  value: integer('value').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const stockOrderFeeRlsPolicy = childOrgRlsPolicy(stockOrderFee, {
  parent: 'stock_order',
  fk: 'stock_order_id',
});

export const stockOrderRelations = relations(stockOrder, ({ one, many }) => ({
  organization: one(organization, {
    fields: [stockOrder.organizationId],
    references: [organization.id],
  }),
  supplier: one(supplier, {
    fields: [stockOrder.supplierId],
    references: [supplier.id],
  }),
  location: one(organizationLocation, {
    fields: [stockOrder.locationId],
    references: [organizationLocation.id],
  }),
  createdBy: one(user, {
    fields: [stockOrder.createdById],
    references: [user.id],
  }),
  items: many(stockOrderItem),
  fees: many(stockOrderFee),
}));

export const stockOrderItemRelations = relations(stockOrderItem, ({ one }) => ({
  stockOrder: one(stockOrder, {
    fields: [stockOrderItem.stockOrderId],
    references: [stockOrder.id],
  }),
  product: one(product, {
    fields: [stockOrderItem.productId],
    references: [product.id],
  }),
}));

export const stockOrderFeeRelations = relations(stockOrderFee, ({ one }) => ({
  stockOrder: one(stockOrder, {
    fields: [stockOrderFee.stockOrderId],
    references: [stockOrder.id],
  }),
}));

export type StockOrder = typeof stockOrder.$inferSelect;
export type NewStockOrder = typeof stockOrder.$inferInsert;
export type StockOrderItem = typeof stockOrderItem.$inferSelect;
export type NewStockOrderItem = typeof stockOrderItem.$inferInsert;
export type StockOrderFee = typeof stockOrderFee.$inferSelect;
export type NewStockOrderFee = typeof stockOrderFee.$inferInsert;
