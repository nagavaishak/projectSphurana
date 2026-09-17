import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { joinRlsPolicy, orgRlsPolicy } from '../rls-policy.js';
import { organizationServiceCategory } from './organization-service-category.js';
import { organizationService } from './organization-service.js';
import { organization } from './organization.js';

/**
 * A bundle of service variants sold at a single price. Discount semantics
 * are implicit: the package's priceCents is what the customer pays, and
 * savings are computed against the sum of item variant prices at display
 * time.
 *
 * validityDays: optional expiry window from purchase. Null means no expiry.
 */
export const organizationPackage = pgTable(
  'organization_package',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    description: text('description'),

    categoryId: text('category_id').references(
      () => organizationServiceCategory.id,
      { onDelete: 'set null' }
    ),

    priceCents: integer('price_cents').notNull(),

    validityDays: integer('validity_days'),

    // Deposit settings (per-package)
    requiresDeposit: boolean('requires_deposit').notNull().default(false),
    depositAmountCents: integer('deposit_amount_cents'),

    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('organization_package_name_unique').on(
      table.organizationId,
      table.name
    ),
    index('idx_organization_package_organization_id').on(table.organizationId),
  ]
);

export const organizationPackageRlsPolicy = orgRlsPolicy(organizationPackage);

/**
 * Items inside a package. Each row is `quantity` redemptions of a given
 * service. Restrict on service delete: a service referenced by a
 * package cannot be deleted; the org must remove it from the package
 * first.
 */
export const organizationPackageItem = pgTable(
  'organization_package_item',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    packageId: text('package_id')
      .notNull()
      .references(() => organizationPackage.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => organizationService.id, {
        onDelete: 'restrict',
      }),

    quantity: integer('quantity').notNull().default(1),
    sortOrder: integer('sort_order').notNull().default(0),

    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('organization_package_item_unique').on(
      table.packageId,
      table.serviceId
    ),
    index('idx_organization_package_item_package_id').on(table.packageId),
    index('idx_organization_package_item_service_id').on(table.serviceId),
  ]
);

export const organizationPackageRelations = relations(
  organizationPackage,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [organizationPackage.organizationId],
      references: [organization.id],
    }),
    category: one(organizationServiceCategory, {
      fields: [organizationPackage.categoryId],
      references: [organizationServiceCategory.id],
    }),
    items: many(organizationPackageItem),
  })
);

export const organizationPackageItemRelations = relations(
  organizationPackageItem,
  ({ one }) => ({
    package: one(organizationPackage, {
      fields: [organizationPackageItem.packageId],
      references: [organizationPackage.id],
    }),
    service: one(organizationService, {
      fields: [organizationPackageItem.serviceId],
      references: [organizationService.id],
    }),
  })
);

// Bucket B2: organization_package_item is a join table
// (organization_package ↔ organization_service). Both parents are org-scoped.
// We route via package_id because organization_package has organization_id
// indexed and is the natural owner.
export const organizationPackageItemRlsPolicy = joinRlsPolicy(
  organizationPackageItem,
  {
    parent: 'organization_package',
    fk: 'package_id',
  }
);

export type OrganizationPackage = typeof organizationPackage.$inferSelect;
export type NewOrganizationPackage = typeof organizationPackage.$inferInsert;
export type OrganizationPackageItem =
  typeof organizationPackageItem.$inferSelect;
export type NewOrganizationPackageItem =
  typeof organizationPackageItem.$inferInsert;
