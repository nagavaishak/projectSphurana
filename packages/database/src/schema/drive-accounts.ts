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
 * Google Drive accounts connected to an organization.
 * Allows users to browse and import video files from their Drive.
 */
export const driveAccount = pgTable(
  'drive_account',
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
    profilePicture: text('profile_picture'),

    encryptedCredentials: text('encrypted_credentials').notNull(),
    tokenExpiresAt: timestamp('token_expires_at'),

    isActive: boolean('is_active').default(true).notNull(),
    lastSyncAt: timestamp('last_sync_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('unique_org_drive_email').on(table.organizationId, table.email),
    index('idx_drive_account_user_id').on(table.userId),
  ]
);

export const driveAccountRlsPolicy = orgRlsPolicy(driveAccount);

// Types
export type DriveAccount = typeof driveAccount.$inferSelect;
export type NewDriveAccount = typeof driveAccount.$inferInsert;
