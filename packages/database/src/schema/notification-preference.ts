import {
  type NotificationPreferencesData,
  defaultNotificationPreferences,
} from '@borradh-workspace/labels';
import { relations } from 'drizzle-orm';
import { boolean, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './user.js';

export type { NotificationPreferencesData };
export { defaultNotificationPreferences };

export const notificationPreference = pgTable('notification_preference', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: 'cascade' }),
  bookingReminders: boolean('booking_reminders').notNull().default(true),
  bookingAlerts: boolean('booking_alerts').notNull().default(true),
  messageNotifications: boolean('message_notifications')
    .notNull()
    .default(true),
  marketingEmails: boolean('marketing_emails').notNull().default(false),
  appUpdates: boolean('app_updates').notNull().default(false),
  weeklyDigest: boolean('weekly_digest').notNull().default(false),
  // Granular per-category notification settings (scope + channels). Stored as
  // JSON so adding a category or knob never needs a migration. The columns
  // above are legacy (superseded by `preferences`) and kept only for the
  // separate marketing/digest settings.
  preferences: jsonb('preferences')
    .$type<NotificationPreferencesData>()
    .notNull()
    .default(defaultNotificationPreferences),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const notificationPreferenceRelations = relations(
  notificationPreference,
  ({ one }) => ({
    user: one(user, {
      fields: [notificationPreference.userId],
      references: [user.id],
    }),
  })
);

export type NotificationPreference = typeof notificationPreference.$inferSelect;
export type NewNotificationPreference =
  typeof notificationPreference.$inferInsert;
