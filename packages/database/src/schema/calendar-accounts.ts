import { createId } from '@paralleldrive/cuid2';
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { organization } from './organization.js';
import { user } from './user.js';

/**
 * Google Calendar accounts connected to an organization.
 * Supports two-way sync for availability and event management.
 */
export const calendarAccount = pgTable(
  'calendar_account',
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
    email: text('email').notNull(),
    displayName: text('display_name'),
    calendarId: text('calendar_id').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    syncEnabled: boolean('sync_enabled').default(true).notNull(),
    encryptedCredentials: text('encrypted_credentials').notNull(),
    lastSyncAt: timestamp('last_sync_at'),
    tokenExpiresAt: timestamp('token_expires_at'),

    // Push notification watch channel fields
    watchChannelId: text('watch_channel_id'),
    watchResourceId: text('watch_resource_id'),
    watchExpiration: timestamp('watch_expiration'),
    syncToken: text('sync_token'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('unique_org_calendar_email').on(table.organizationId, table.email),
    index('idx_calendar_account_user_id').on(table.userId),
  ]
);

export const calendarAccountRlsPolicy = orgRlsPolicy(calendarAccount);

export type CalendarAccount = typeof calendarAccount.$inferSelect;
export type NewCalendarAccount = typeof calendarAccount.$inferInsert;
