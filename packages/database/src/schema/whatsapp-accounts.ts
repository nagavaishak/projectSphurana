import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { tokenStatusEnum } from './meta-ads-integration.js';
import { organization } from './organization.js';
import { user } from './user.js';

/**
 * WhatsApp Business Account - stores connected WhatsApp Business accounts
 * Each org can have multiple WhatsApp Business accounts connected
 */
export const whatsappAccount = pgTable(
  'whatsapp_account',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    connectedById: text('connected_by_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    // WhatsApp Business API identifiers
    phoneNumberId: text('phone_number_id').notNull(),
    wabaId: text('waba_id').notNull(), // WhatsApp Business Account ID
    phoneNumber: text('phone_number').notNull(), // Display phone number
    displayName: text('display_name'),

    // Status
    isActive: boolean('is_active').default(true).notNull(),
    isVerified: boolean('is_verified').default(false).notNull(),

    // Whether the AI chatbot is enabled for this account
    isChatbotActive: boolean('is_chatbot_active').default(false).notNull(),

    // Encrypted credentials (access token, etc.)
    encryptedCredentials: text('encrypted_credentials').notNull(),

    // Token expiration tracking
    tokenExpiresAt: timestamp('token_expires_at'),
    tokenStatus: tokenStatusEnum('token_status').notNull().default('valid'),

    // Sync tracking
    lastSyncAt: timestamp('last_sync_at'),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Each phone number can only be connected once per org
    unique('unique_org_phone_number').on(
      table.organizationId,
      table.phoneNumberId
    ),
    index('idx_whatsapp_account_connected_by_id').on(table.connectedById),
  ]
);

export const whatsappAccountRlsPolicy = orgRlsPolicy(whatsappAccount);

export const whatsappAccountRelations = relations(
  whatsappAccount,
  ({ one }) => ({
    organization: one(organization, {
      fields: [whatsappAccount.organizationId],
      references: [organization.id],
    }),
    connectedBy: one(user, {
      fields: [whatsappAccount.connectedById],
      references: [user.id],
    }),
  })
);

export type WhatsAppAccount = typeof whatsappAccount.$inferSelect;
export type NewWhatsAppAccount = typeof whatsappAccount.$inferInsert;
