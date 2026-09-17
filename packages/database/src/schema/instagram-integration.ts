import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import { boolean, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { tokenStatusEnum } from './meta-ads-integration.js';
import { organization } from './organization.js';
import { user } from './user.js';

/**
 * Instagram Integration - stores the organization's standalone Instagram connection
 * Uses the Instagram Login API (separate from Meta Ads / Facebook Login)
 * One Instagram account per organization.
 */
export const instagramIntegration = pgTable(
  'instagram_integration',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    connectedById: text('connected_by_id').references(() => user.id, {
      onDelete: 'set null',
    }),

    // Encrypted token (AES-256-GCM)
    encryptedCredentials: text('encrypted_credentials'),
    tokenExpiresAt: timestamp('token_expires_at'),

    // Instagram profile (captured during OAuth)
    instagramUserId: text('instagram_user_id'),
    username: text('username'),
    name: text('name'),
    profilePictureUrl: text('profile_picture_url'),
    accountType: text('account_type'), // 'BUSINESS' | 'MEDIA_CREATOR' | 'PERSONAL'

    isActive: boolean('is_active').notNull().default(true),
    chatbotEnabled: boolean('chatbot_enabled').notNull().default(false),

    // Token health status (set to 'needs_reconnect' when Meta returns auth errors)
    tokenStatus: tokenStatusEnum('token_status').notNull().default('valid'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [unique('unique_org_instagram').on(table.organizationId)]
);

export const instagramIntegrationRlsPolicy = orgRlsPolicy(instagramIntegration);

export const instagramIntegrationRelations = relations(
  instagramIntegration,
  ({ one }) => ({
    organization: one(organization, {
      fields: [instagramIntegration.organizationId],
      references: [organization.id],
    }),
    connectedBy: one(user, {
      fields: [instagramIntegration.connectedById],
      references: [user.id],
    }),
  })
);

export type InstagramIntegration = typeof instagramIntegration.$inferSelect;
export type NewInstagramIntegration = typeof instagramIntegration.$inferInsert;
