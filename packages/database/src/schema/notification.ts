import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { organization } from './organization.js';
import { user } from './user.js';

// Import labels from enums (pure TypeScript)
import {
  notificationTypeLabels,
  notificationTypeValues,
} from '@borradh-workspace/labels';
import type { NotificationType } from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export { notificationTypeLabels, notificationTypeValues };
export type { NotificationType };

// One row per recipient: an org-wide event fans out into a row per user, so
// read state (readAt) is per-user. `type` is a typed text column rather than a
// pgEnum so new notification types never need an `ALTER TYPE` migration.
export const notification = pgTable(
  'notification',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: text('type').$type<NotificationType>().notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    // Optional in-app deep link (e.g. /dashboard/appointments).
    linkPath: text('link_path'),
    // Optional structured payload (entity ids, etc.) for the UI.
    data: jsonb('data').$type<Record<string, unknown>>(),
    // Null = unread.
    readAt: timestamp('read_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_notification_user_id').on(table.userId),
    // Drives the unread-count query and the feed (ordered, filtered by user).
    index('idx_notification_user_read').on(table.userId, table.readAt),
    index('idx_notification_org_id').on(table.organizationId),
  ]
);

export const notificationRelations = relations(notification, ({ one }) => ({
  user: one(user, {
    fields: [notification.userId],
    references: [user.id],
  }),
  organization: one(organization, {
    fields: [notification.organizationId],
    references: [organization.id],
  }),
}));

export const notificationRlsPolicy = orgRlsPolicy(notification);

export type Notification = typeof notification.$inferSelect;
export type NewNotification = typeof notification.$inferInsert;
