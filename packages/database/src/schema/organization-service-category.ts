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
import { orgRlsPolicy } from '../rls-policy.js';
import { organization } from './organization.js';

/**
 * Custom service categories per organization. Replaces the fixed
 * service_category enum on organization_service. The enum stays in place
 * during migration; categoryId on organization_service will be wired up
 * in a follow-up migration that backfills from the enum.
 */
export const organizationServiceCategory = pgTable(
  'organization_service_category',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    description: text('description'),

    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('organization_service_category_name_unique').on(
      table.organizationId,
      table.name
    ),
    index('idx_organization_service_category_organization_id').on(
      table.organizationId
    ),
  ]
);

export const organizationServiceCategoryRlsPolicy = orgRlsPolicy(
  organizationServiceCategory
);

export const organizationServiceCategoryRelations = relations(
  organizationServiceCategory,
  ({ one }) => ({
    organization: one(organization, {
      fields: [organizationServiceCategory.organizationId],
      references: [organization.id],
    }),
  })
);

export type OrganizationServiceCategory =
  typeof organizationServiceCategory.$inferSelect;
export type NewOrganizationServiceCategory =
  typeof organizationServiceCategory.$inferInsert;
