import { relations } from 'drizzle-orm';
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { joinRlsPolicy, orgRlsPolicy } from '../rls-policy.js';
import { asset } from './asset.js';
import { organizationService } from './organization-service.js';
import { organization } from './organization.js';

// Import labels from enums (pure TypeScript)
import {
  faceGroupAssetRoleLabels,
  faceGroupAssetRoleValues,
} from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export { faceGroupAssetRoleLabels, faceGroupAssetRoleValues };
export type { FaceGroupAssetRole } from '@borradh-workspace/labels';

// Database enums
export const faceGroupAssetRoleEnum = pgEnum(
  'face_group_asset_role',
  faceGroupAssetRoleValues
);

// ── face_group table ──
//
// A face_group pairs a client's before/after photos for video creation. It was
// once populated by biometric face recognition (AWS Rekognition); that
// processing was removed for GDPR compliance and the group is now only ever
// created by manual before/after pairing (see create-manual-pair). No biometric
// data is stored: the columns below are ordinary business records.
export const faceGroup = pgTable(
  'face_group',
  {
    id: text('id').primaryKey(),

    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    // User-assigned client name
    clientName: text('client_name'),

    // Optional notes about the client
    clientNotes: text('client_notes'),

    // Linked service (procedure this client received)
    serviceId: text('service_id').references(() => organizationService.id, {
      onDelete: 'set null',
    }),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_face_group_org_id').on(table.organizationId),
    index('idx_face_group_service_id').on(table.serviceId),
  ]
);

export const faceGroupRlsPolicy = orgRlsPolicy(faceGroup);

export const faceGroupRelations = relations(faceGroup, ({ one, many }) => ({
  organization: one(organization, {
    fields: [faceGroup.organizationId],
    references: [organization.id],
  }),
  service: one(organizationService, {
    fields: [faceGroup.serviceId],
    references: [organizationService.id],
  }),
  assets: many(faceGroupAsset),
}));

// ── face_group_asset junction table ──
export const faceGroupAsset = pgTable(
  'face_group_asset',
  {
    id: text('id').primaryKey(),

    faceGroupId: text('face_group_id')
      .notNull()
      .references(() => faceGroup.id, { onDelete: 'cascade' }),

    assetId: text('asset_id')
      .notNull()
      .references(() => asset.id, { onDelete: 'cascade' }),

    // Denormalized for fast batch queries
    batchId: text('batch_id'),

    // Before/after role
    role: faceGroupAssetRoleEnum('role').notNull().default('untagged'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    uniqueFaceGroupAsset: unique().on(t.faceGroupId, t.assetId),
    idxFaceGroupAssetAssetId: index('idx_face_group_asset_asset_id').on(
      t.assetId
    ),
  })
);

export const faceGroupAssetRelations = relations(faceGroupAsset, ({ one }) => ({
  faceGroup: one(faceGroup, {
    fields: [faceGroupAsset.faceGroupId],
    references: [faceGroup.id],
  }),
  asset: one(asset, {
    fields: [faceGroupAsset.assetId],
    references: [asset.id],
  }),
}));

// Bucket B2: face_group_asset is a join table (face_group ↔ asset). Both
// parents are org-scoped. We route via face_group_id because face_group has
// organization_id indexed (idx_face_group_org_id).
export const faceGroupAssetRlsPolicy = joinRlsPolicy(faceGroupAsset, {
  parent: 'face_group',
  fk: 'face_group_id',
});

// Types
export type FaceGroup = typeof faceGroup.$inferSelect;
export type NewFaceGroup = typeof faceGroup.$inferInsert;
export type FaceGroupAsset = typeof faceGroupAsset.$inferSelect;
export type NewFaceGroupAsset = typeof faceGroupAsset.$inferInsert;
