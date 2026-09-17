import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { graphic } from './graphic.js';
import { organization } from './organization.js';
import { user } from './user.js';
import { video } from './video.js';

// Import labels from enums (pure TypeScript)
import {
  socialPlatformLabels,
  socialPlatformValues,
  socialPostMediaTypeLabels,
  socialPostMediaTypeValues,
  socialPostStatusLabels,
  socialPostStatusValues,
} from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export {
  socialPostStatusLabels,
  socialPostStatusValues,
  socialPostMediaTypeLabels,
  socialPostMediaTypeValues,
  socialPlatformLabels,
  socialPlatformValues,
};
export type {
  SocialPostStatus,
  SocialPostMediaType,
  SocialPlatform,
} from '@borradh-workspace/labels';

// Database enums
export const socialPostStatusEnum = pgEnum(
  'social_post_status',
  socialPostStatusValues
);

export const socialPostMediaTypeEnum = pgEnum(
  'social_post_media_type',
  socialPostMediaTypeValues
);

export const socialPlatformEnum = pgEnum(
  'social_platform',
  socialPlatformValues
);

// ==================== TYPE INTERFACES ====================

/**
 * Result of publishing to a single platform
 */
export interface PlatformPublishResult {
  platform: 'facebook' | 'instagram';
  success: boolean;
  postId?: string;
  postUrl?: string;
  error?: string;
  publishedAt?: string;
}

/**
 * Platform-specific settings (for future extensibility)
 */
export interface PlatformSettings {
  facebook?: {
    pageId?: string;
    // Future: specific targeting, link attachments, etc.
  };
  instagram?: {
    accountId?: string;
    // Future: story vs feed, reels settings, etc.
  };
}

// ==================== SOCIAL POSTS TABLE ====================

/**
 * Social Post - represents a scheduled or published social media post
 * Can target multiple platforms (Facebook, Instagram)
 */
export const socialPost = pgTable(
  'social_post',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    // Post content
    title: text('title').notNull(), // Internal name for organization
    caption: text('caption'), // The actual post text/caption

    // Media
    mediaType: socialPostMediaTypeEnum('media_type').notNull(),
    mediaUrl: text('media_url').notNull(), // URL to the image/video file (first slide for carousels)
    // Ordered list of media URLs for multi-image carousel posts. Null/single
    // entry = a normal single-image/video post (mediaUrl is authoritative).
    // Two or more entries = an image carousel; mediaUrl[0] === mediaUrls[0].
    mediaUrls: jsonb('media_urls').$type<string[]>(),
    thumbnailUrl: text('thumbnail_url'), // Thumbnail for videos
    videoId: text('video_id').references(() => video.id, {
      onDelete: 'set null',
    }), // Optional link to video table
    graphicId: text('graphic_id').references(() => graphic.id, {
      onDelete: 'set null',
    }), // Optional link to graphic table

    // Target platforms (array of platform names)
    platforms: jsonb('platforms')
      .$type<('facebook' | 'instagram')[]>()
      .notNull(),

    // Platform-specific settings
    platformSettings: jsonb('platform_settings').$type<PlatformSettings>(),

    // Scheduling
    scheduledAt: timestamp('scheduled_at'), // When to publish (null = draft, needs manual publish)
    publishedAt: timestamp('published_at'), // When actually published

    // Status
    status: socialPostStatusEnum('status').notNull().default('draft'),

    // Publishing results (one entry per platform attempted)
    platformResults: jsonb('platform_results').$type<PlatformPublishResult[]>(),

    // Error tracking
    errorMessage: text('error_message'),

    // Ownership
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
    index('idx_social_post_org_id').on(table.organizationId),
    index('idx_social_post_video_id').on(table.videoId),
    index('idx_social_post_graphic_id').on(table.graphicId),
    index('idx_social_post_created_by_id').on(table.createdById),
  ]
);

export const socialPostRlsPolicy = orgRlsPolicy(socialPost);

// ==================== RELATIONS ====================

export const socialPostRelations = relations(socialPost, ({ one }) => ({
  organization: one(organization, {
    fields: [socialPost.organizationId],
    references: [organization.id],
  }),
  createdBy: one(user, {
    fields: [socialPost.createdById],
    references: [user.id],
  }),
  video: one(video, {
    fields: [socialPost.videoId],
    references: [video.id],
  }),
  graphic: one(graphic, {
    fields: [socialPost.graphicId],
    references: [graphic.id],
  }),
}));

// ==================== TYPE EXPORTS ====================

export type SocialPost = typeof socialPost.$inferSelect;
export type NewSocialPost = typeof socialPost.$inferInsert;
