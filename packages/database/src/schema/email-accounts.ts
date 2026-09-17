import { createId } from '@paralleldrive/cuid2';
import {
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { organization } from './organization.js';

// Import labels from enums (pure TypeScript)
import {
  emailProviderLabels,
  emailProviderValues,
} from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export { emailProviderLabels, emailProviderValues };
export type { EmailProvider } from '@borradh-workspace/labels';

// Database enums
export const emailProviderEnum = pgEnum('email_provider', emailProviderValues);

/**
 * Email accounts connected to an organization.
 * Supports multiple accounts per organization for follow-up sequences.
 */
export const emailAccount = pgTable(
  'email_account',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    provider: emailProviderEnum('provider').notNull(),
    email: text('email').notNull(),
    displayName: text('display_name'),
    isActive: boolean('is_active').default(true).notNull(),
    encryptedCredentials: text('encrypted_credentials').notNull(),
    lastSyncAt: timestamp('last_sync_at'),
    tokenExpiresAt: timestamp('token_expires_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [unique('unique_org_email').on(table.organizationId, table.email)]
);

export const emailAccountRlsPolicy = orgRlsPolicy(emailAccount);

export type EmailAccount = typeof emailAccount.$inferSelect;
export type NewEmailAccount = typeof emailAccount.$inferInsert;
