import { relations } from 'drizzle-orm';
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { childOrgRlsPolicy } from '../rls-policy.js';

import {
  videoDraftClipProcessingStatusLabels,
  videoDraftClipProcessingStatusValues,
  videoDraftClipSourceLabels,
  videoDraftClipSourceValues,
} from '@borradh-workspace/labels';
import { asset } from './asset.js';
import { video } from './video.js';

// Re-export labels and types for consumers
export {
  videoDraftClipSourceLabels,
  videoDraftClipSourceValues,
  videoDraftClipProcessingStatusLabels,
  videoDraftClipProcessingStatusValues,
};
export type {
  VideoDraftClipSource,
  VideoDraftClipProcessingStatus,
} from '@borradh-workspace/labels';

// Database enums
export const videoDraftClipSourceEnum = pgEnum(
  'video_draft_clip_source',
  videoDraftClipSourceValues
);

export const videoDraftClipProcessingStatusEnum = pgEnum(
  'video_draft_clip_processing_status',
  videoDraftClipProcessingStatusValues
);

/**
 * Video draft clip — chat-native tray row (W-C10-clip-tray).
 *
 * Each row represents one clip in the persistent "Clips for this video" tray
 * scoped to a {@link video} draft. Clips can land via three sources:
 *  - `uploaded`: operator drag-dropped a file into the chat composer this
 *    session; the upload pipeline created the asset row, then this tray row.
 *  - `library`: operator picked an existing asset library row.
 *  - `suggested`: `videos_autoSelectClips` persisted the suggestion after a
 *    fill-the-rest pass; operator can swap before final render.
 *
 * Cross-org isolation flows through the parent {@link video} via JOIN — the
 * service layer always filters `video.organizationId` first. We do not
 * denormalise `organizationId` onto the row to avoid the writer having to
 * keep two FKs in sync; the `idx_video_draft_clip_video_id` covers the
 * by-video filter that every read uses.
 *
 * `assetId` is nullable so an in-flight upload can land an `uploading` row
 * before the asset record is created — but the post-W-C10-clip-tray flow
 * actually creates the asset *first* and only then inserts a tray row, so
 * `assetId` is non-null in practice. Kept nullable for forward-compat with
 * a "stage upload, persist asset on completion" variant if we later want
 * the row to appear instantly during the S3 PUT.
 */
export const videoDraftClip = pgTable(
  'video_draft_clip',
  {
    id: text('id').primaryKey(),

    videoId: text('video_id')
      .notNull()
      .references(() => video.id, { onDelete: 'cascade' }),

    assetId: text('asset_id').references(() => asset.id, {
      onDelete: 'set null',
    }),

    source: videoDraftClipSourceEnum('source').notNull(),

    beatOrder: integer('beat_order').notNull().default(0),

    processingStatus: videoDraftClipProcessingStatusEnum('processing_status')
      .notNull()
      .default('processing'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_video_draft_clip_video_id').on(table.videoId),
    index('idx_video_draft_clip_asset_id').on(table.assetId),
  ]
);

export const videoDraftClipRelations = relations(videoDraftClip, ({ one }) => ({
  video: one(video, {
    fields: [videoDraftClip.videoId],
    references: [video.id],
  }),
  asset: one(asset, {
    fields: [videoDraftClip.assetId],
    references: [asset.id],
  }),
}));

// Bucket B1: video_draft_clip has no organization_id; org scope derives from
// the parent video row via video_id FK.
export const videoDraftClipRlsPolicy = childOrgRlsPolicy(videoDraftClip, {
  parent: 'video',
  fk: 'video_id',
});

export type VideoDraftClip = typeof videoDraftClip.$inferSelect;
export type NewVideoDraftClip = typeof videoDraftClip.$inferInsert;
