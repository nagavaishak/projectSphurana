import { createId } from '@paralleldrive/cuid2';
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { organization } from './organization.js';
import { user } from './user.js';

// Import labels from enums (pure TypeScript)
import {
  bookingProviderLabels,
  bookingProviderValues,
} from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export { bookingProviderLabels, bookingProviderValues };
export type { BookingProvider } from '@borradh-workspace/labels';

// Database enums
export const bookingProviderEnum = pgEnum(
  'booking_provider',
  bookingProviderValues
);

/**
 * Booking platform accounts connected to an organization.
 * Supports OAuth (Calendly, Timely) and API key (Phorest, Fresha) authentication.
 */
export const bookingAccount = pgTable(
  'booking_account',
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
    provider: bookingProviderEnum('provider').notNull(),
    /**
     * Provider-specific account identifier
     * - Calendly: user URI (e.g., https://api.calendly.com/users/xxx)
     * - Timely: account ID
     * - Phorest: business ID
     * - Fresha: partner ID (when available)
     */
    externalAccountId: text('external_account_id'),
    /**
     * Display email or username for the connected account
     */
    email: text('email'),
    /**
     * Human-readable name for the account/business
     */
    displayName: text('display_name'),
    /**
     * Provider-specific configuration (event types, location IDs, etc.)
     */
    config: jsonb('config').$type<BookingAccountConfig>(),
    isActive: boolean('is_active').default(true).notNull(),
    /**
     * Encrypted OAuth tokens or API credentials
     */
    encryptedCredentials: text('encrypted_credentials').notNull(),
    lastSyncAt: timestamp('last_sync_at'),
    tokenExpiresAt: timestamp('token_expires_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('unique_org_booking_provider_account').on(
      table.organizationId,
      table.provider,
      table.externalAccountId
    ),
    index('idx_booking_account_user_id').on(table.userId),
  ]
);

/**
 * Provider-specific configuration stored in the config JSONB column
 */
export interface BookingAccountConfig {
  // Calendly-specific
  calendly?: {
    organizationUri?: string;
    defaultEventTypeUri?: string;
    schedulingUrl?: string;
  };
  // Timely-specific
  timely?: {
    accountId?: string;
    defaultLocationId?: string;
    defaultServiceId?: string;
  };
  // Phorest-specific
  phorest?: {
    businessId?: string;
    branchId?: string;
    region?: 'eu' | 'us';
  };
  // Fresha-specific (for future use)
  fresha?: {
    partnerId?: string;
    locationId?: string;
  };
}

export const bookingAccountRlsPolicy = orgRlsPolicy(bookingAccount);

export type BookingAccount = typeof bookingAccount.$inferSelect;
export type NewBookingAccount = typeof bookingAccount.$inferInsert;
