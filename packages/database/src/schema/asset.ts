import type { PlaceholderType } from '@borradh-workspace/labels';
import { relations } from 'drizzle-orm';
import {
  index,
  integer,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  vector,
} from 'drizzle-orm/pg-core';

import { orgRlsPolicy } from '../rls-policy.js';
import { assetUploadBatch } from './asset-upload-batch.js';
import { organization } from './organization.js';
import { stockClip } from './stock-clip.js';
import { clipAgentSourceEnum } from './treatment-taxonomy.js';
import { user } from './user.js';

// Import labels from enums (pure TypeScript)
import {
  assetSourceLabels,
  assetSourceValues,
  assetTypeLabels,
  assetTypeValues,
} from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export {
  assetTypeLabels,
  assetTypeValues,
  assetSourceLabels,
  assetSourceValues,
};
export type { AssetType, AssetSource } from '@borradh-workspace/labels';

// Database enums
export const assetTypeEnum = pgEnum('asset_type', assetTypeValues);
export const assetSourceEnum = pgEnum('asset_source', assetSourceValues);

/**
 * Asset Schema
 * Stores uploaded video/image assets (source material for creating videos/graphics)
 */
export const asset = pgTable(
  'asset',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    blobUrl: text('blob_url').notNull(),
    thumbnailUrl: text('thumbnail_url'),
    sourceFileName: text('source_file_name'),
    tags: text('tags').array().default([]).notNull(),
    clientName: text('client_name'),

    // Asset type (video or image)
    type: assetTypeEnum('type').notNull().default('video'),

    // Asset source (raw footage vs edited/polished)
    // Raw assets get AI analysis (tags, content type, etc.), edited ones don't
    source: assetSourceEnum('source').notNull().default('raw'),

    // Placeholder types this asset can be used for (array for flexibility)
    // e.g., ['owner_bodyshot', 'staff_photo'] - this asset can fill either placeholder type
    placeholderTypes: text('placeholder_types')
      .array()
      .$type<PlaceholderType[]>()
      .default([])
      .notNull(),

    // Video-specific metadata
    duration: real('duration'), // Only for videos

    // Shared metadata
    width: integer('width'),
    height: integer('height'),

    // Probe metadata (populated by asset-probe processor)
    codec: text('codec'),
    pixFmt: text('pix_fmt'),
    bitrateKbps: integer('bitrate_kbps'),
    probeStatus: text('probe_status')
      .$type<'pending' | 'ready' | 'failed'>()
      .notNull()
      .default('pending'),
    probedAt: timestamp('probed_at'),

    // Transcode pipeline (normalizes b-roll to ≤1080p H.264 yuv420p).
    // Defaults to 'skipped' so rows present at migration time don't trip the
    // queueVideoExport gate. createAsset explicitly sets this to 'pending'
    // for new video uploads, so they flow through probe → transcode.
    transcodeStatus: text('transcode_status')
      .$type<'pending' | 'skipped' | 'ready' | 'failed'>()
      .notNull()
      .default('skipped'),
    transcodedBlobUrl: text('transcoded_blob_url'),
    transcodedAt: timestamp('transcoded_at'),

    // Optional transcription for testimonial assets (videos only)
    transcript: text('transcript'),

    // Original capture timestamp from file metadata (EXIF/file.lastModified)
    capturedAt: timestamp('captured_at'),

    // Batch tracking (for bulk uploads)
    batchId: text('batch_id'),

    // Set when this asset was minted copy-on-attach from a curated stock_clip
    // (source='stock'). User uploads leave it null. Lets an org reuse a single
    // minted asset per stock clip instead of duplicating on every video.
    stockClipId: text('stock_clip_id').references(() => stockClip.id, {
      onDelete: 'set null',
    }),

    // ── FOOTAGE DESCRIPTOR ───────────────────────────────────────────────
    // Identical to the descriptor on stock_clip, so one matcher can rank an
    // org's own footage and curated stock together (see the matchable_clip
    // view). Storage stays split because asset is org-scoped under RLS and
    // stock_clip is global reference data.
    //
    // The split between DECLARED identity and OBSERVED description is
    // load-bearing — see docs/plans/stock-footage-matching-architecture.md.
    // Vision cannot tell endospheres from EMS (it hedges to "specialized
    // equipment", even when given the org's service list), so identity is
    // never inferred from pixels.

    // DECLARED. For uploads this is inherited from the service the clip was
    // linked to — the org's own catalogue is a more reliable label than any
    // vision model, because a clip at Epicentr is endospheres by virtue of
    // Epicentr selling endospheres.
    agentSlug: text('agent_slug'),
    techniqueSlug: text('technique_slug'),

    // DECLARED / confirmed. Controlled region vocabulary.
    regions: text('regions').array().notNull().default([]),

    // Records whether identity was asserted by a human or guessed. The gate
    // treats 'unconfirmed' as UNKNOWN, never as fact — which is what stops a
    // coin-flip guess being laundered into a confident match.
    agentSource: clipAgentSourceEnum('agent_source')
      .notNull()
      .default('unconfirmed'),

    // GENERATED and deliberately ORG-BLIND: what is visible in the frame, with
    // no knowledge of which org owns it or what they sell. Org context here
    // would make the clip non-portable — a clip captioned "endospheres"
    // because the org sells endospheres can never be safely reused, and nobody
    // could later tell whether that was seen or assumed.
    visualDescription: text('visual_description'),

    // pgvector embedding of visualDescription. Ranks candidates WITHIN the
    // gate; never used to decide identity, because two treatments that look
    // alike are genuinely near-neighbours and no threshold separates them.
    embedding: vector('embedding', { dimensions: 1536 }),

    // Organization and user tracking
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    uploadedById: text('uploaded_by_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at'),
  },
  (table) => [
    index('idx_asset_org_id').on(table.organizationId),
    index('idx_asset_uploaded_by_id').on(table.uploadedById),
    // Dedup lookup for copy-on-attach: reuse an org's minted asset per clip.
    index('idx_asset_stock_clip_id').on(table.stockClipId),
  ]
);

// Re-export placeholder type labels for convenience
export {
  placeholderTypeLabels,
  placeholderTypeValues,
  type PlaceholderType,
} from '@borradh-workspace/labels';

export const assetRlsPolicy = orgRlsPolicy(asset);

export const assetRelations = relations(asset, ({ one }) => ({
  uploadBatch: one(assetUploadBatch, {
    fields: [asset.batchId],
    references: [assetUploadBatch.id],
  }),
  organization: one(organization, {
    fields: [asset.organizationId],
    references: [organization.id],
  }),
  uploadedBy: one(user, {
    fields: [asset.uploadedById],
    references: [user.id],
  }),
  stockClip: one(stockClip, {
    fields: [asset.stockClipId],
    references: [stockClip.id],
  }),
}));

export type Asset = typeof asset.$inferSelect;
export type NewAsset = typeof asset.$inferInsert;
