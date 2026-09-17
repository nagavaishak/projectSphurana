import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { childOrgRlsPolicy, orgRlsPolicy } from '../rls-policy.js';
import { organizationLocation } from './organization-location.js';
import { organization } from './organization.js';
import { product } from './product.js';
import { user } from './user.js';

// Import labels from enums (pure TypeScript)
import {
  stockTakeStatusLabels,
  stockTakeStatusValues,
} from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export { stockTakeStatusLabels, stockTakeStatusValues };
export type { StockTakeStatus } from '@borradh-workspace/labels';

// Database enums
export const stockTakeStatusEnum = pgEnum(
  'stock_take_status',
  stockTakeStatusValues
);

export const stockTake = pgTable(
  'stock_take',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name'),
    description: text('description'),
    // Stock takes are per-location since stock is per-location
    locationId: text('location_id').references(() => organizationLocation.id, {
      onDelete: 'set null',
    }),
    status: stockTakeStatusEnum('status').notNull().default('in_progress'),
    createdById: text('created_by_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('idx_stock_take_org_id').on(table.organizationId)]
);

export const stockTakeRlsPolicy = orgRlsPolicy(stockTake);

export const stockTakeItem = pgTable(
  'stock_take_item',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    stockTakeId: text('stock_take_id')
      .notNull()
      .references(() => stockTake.id, { onDelete: 'cascade' }),
    // restrict: stock take history must survive — soft-deactivate products instead
    productId: text('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'restrict' }),
    // Snapshot of product_stock at creation
    expectedQuantity: integer('expected_quantity').notNull(),
    // NULL until counted
    countedQuantity: integer('counted_quantity'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('stock_take_item_unique').on(table.stockTakeId, table.productId),
  ]
);

export const stockTakeItemRlsPolicy = childOrgRlsPolicy(stockTakeItem, {
  parent: 'stock_take',
  fk: 'stock_take_id',
});

export const stockTakeRelations = relations(stockTake, ({ one, many }) => ({
  organization: one(organization, {
    fields: [stockTake.organizationId],
    references: [organization.id],
  }),
  location: one(organizationLocation, {
    fields: [stockTake.locationId],
    references: [organizationLocation.id],
  }),
  createdBy: one(user, {
    fields: [stockTake.createdById],
    references: [user.id],
  }),
  items: many(stockTakeItem),
}));

export const stockTakeItemRelations = relations(stockTakeItem, ({ one }) => ({
  stockTake: one(stockTake, {
    fields: [stockTakeItem.stockTakeId],
    references: [stockTake.id],
  }),
  product: one(product, {
    fields: [stockTakeItem.productId],
    references: [product.id],
  }),
}));

export type StockTake = typeof stockTake.$inferSelect;
export type NewStockTake = typeof stockTake.$inferInsert;
export type StockTakeItem = typeof stockTakeItem.$inferSelect;
export type NewStockTakeItem = typeof stockTakeItem.$inferInsert;
