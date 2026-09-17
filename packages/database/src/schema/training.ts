import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { user } from './user.js';

// Import labels from enums (pure TypeScript)
import {
  trainingCategoryLabels,
  trainingCategoryValues,
} from '@borradh-workspace/labels';

// Re-export labels and values for consumers
export { trainingCategoryLabels, trainingCategoryValues };
export type { TrainingCategory } from '@borradh-workspace/labels';

// Database enum
export const trainingCategoryEnum = pgEnum(
  'training_category',
  trainingCategoryValues
);

/**
 * Training video table - stores training/tutorial videos
 * Videos are stored in S3 public bucket and served via CloudFront CDN
 */
export const trainingVideo = pgTable('training_video', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),

  // Video metadata
  cdnUrl: text('cdn_url').notNull(),
  thumbnailUrl: text('thumbnail_url'),
  durationSeconds: integer('duration_seconds'),

  // Categorization
  category: trainingCategoryEnum('category').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),

  // Status
  isPublished: boolean('is_published').default(true).notNull(),

  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export type TrainingVideo = typeof trainingVideo.$inferSelect;
export type NewTrainingVideo = typeof trainingVideo.$inferInsert;

/**
 * User video progress table - tracks which videos users have watched
 */
export const userVideoProgress = pgTable(
  'user_video_progress',
  {
    id: text('id').primaryKey(),

    // References
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    trainingVideoId: text('training_video_id')
      .notNull()
      .references(() => trainingVideo.id, { onDelete: 'cascade' }),

    // Progress tracking
    watchedSeconds: integer('watched_seconds').default(0).notNull(),
    isCompleted: boolean('is_completed').default(false).notNull(),
    completedAt: timestamp('completed_at'),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique('user_video_progress_unique').on(
      table.userId,
      table.trainingVideoId
    ),
    index('idx_user_video_progress_video_id').on(table.trainingVideoId),
  ]
);

export type UserVideoProgress = typeof userVideoProgress.$inferSelect;
export type NewUserVideoProgress = typeof userVideoProgress.$inferInsert;
