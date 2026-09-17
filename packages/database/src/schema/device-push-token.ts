import { relations } from 'drizzle-orm';
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './user.js';

export const devicePushToken = pgTable('device_push_token', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  platform: text('platform').$type<'ios' | 'android'>().notNull(),
  // 'expo' = legacy Expo proxy token (ExponentPushToken[...]); 'apns' = raw iOS
  // APNs device token; 'fcm' = raw Android FCM registration token. Set by the
  // client at registration so the server-side delivery layer can pick the right
  // path (expo-server-sdk vs node-apn vs firebase-admin).
  tokenType: text('token_type')
    .$type<'expo' | 'apns' | 'fcm'>()
    .notNull()
    .default('expo'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const devicePushTokenRelations = relations(
  devicePushToken,
  ({ one }) => ({
    user: one(user, {
      fields: [devicePushToken.userId],
      references: [user.id],
    }),
  })
);

export type DevicePushToken = typeof devicePushToken.$inferSelect;
export type NewDevicePushToken = typeof devicePushToken.$inferInsert;
