import { relations } from 'drizzle-orm';
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { asset } from './asset.js';
import { organization } from './organization.js';
import { user } from './user.js';

// Import labels from enums (pure TypeScript)
import {
  assetUploadBatchStatusLabels,
  assetUploadBatchStatusValues,
} from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export { assetUploadBatchStatusLabels, assetUploadBatchStatusValues };
export type { AssetUploadBatchStatus } from '@borradh-workspace/labels';

// Database enum
export const assetUploadBatchStatusEnum = pgEnum(
  'asset_upload_batch_status',
  assetUploadBatchStatusValues
);

/**
 * Asset Upload Batch Schema
 * Tracks bulk asset uploads as a unit for efficient status polling
 */
export const assetUploadBatch = pgTable(
  'asset_upload_batch',
  {
    id: text('id').primaryKey(),

    // Batch metadata
    totalAssets: integer('total_assets').notNull(),
    completedAssets: integer('completed_assets').notNull().default(0),
    failedAssets: integer('failed_assets').notNull().default(0),

    // Status tracking
    status: assetUploadBatchStatusEnum('status').notNull().default('pending'),

    // Organization and user tracking
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    createdById: text('created_by_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    // Timestamps
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_asset_upload_batch_org_id').on(table.organizationId),
    index('idx_asset_upload_batch_created_by_id').on(table.createdById),
  ]
);

export const assetUploadBatchRlsPolicy = orgRlsPolicy(assetUploadBatch);

export const assetUploadBatchRelations = relations(
  assetUploadBatch,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [assetUploadBatch.organizationId],
      references: [organization.id],
    }),
    createdBy: one(user, {
      fields: [assetUploadBatch.createdById],
      references: [user.id],
    }),
    assets: many(asset),
  })
);

// Types
export type AssetUploadBatch = typeof assetUploadBatch.$inferSelect;
export type NewAssetUploadBatch = typeof assetUploadBatch.$inferInsert;
