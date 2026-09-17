import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { organization } from './organization.js';

// Import labels from enums (pure TypeScript)
import {
  phoneNumberProviderLabels,
  phoneNumberProviderValues,
  phoneNumberStatusLabels,
  phoneNumberStatusValues,
} from '@borradh-workspace/labels';

// Re-export labels and values for consumers
export {
  phoneNumberStatusLabels,
  phoneNumberStatusValues,
  phoneNumberProviderLabels,
  phoneNumberProviderValues,
};
export type {
  PhoneNumberStatus,
  PhoneNumberProvider,
} from '@borradh-workspace/labels';

// Database enums
export const phoneNumberStatusEnum = pgEnum(
  'phone_number_status',
  phoneNumberStatusValues
);

export const phoneNumberProviderEnum = pgEnum(
  'phone_number_provider',
  phoneNumberProviderValues
);

/**
 * Phone Number - Dedicated phone numbers per organization for outbound voice calls
 *
 * Supports round-robin rotation with lead-number affinity
 * (same lead always sees the same caller ID).
 */
export const phoneNumber = pgTable(
  'phone_number',
  {
    id: text('id').primaryKey(),

    // Organization that owns this number
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    // E.164 format phone number (e.g., +353851234567)
    number: text('number').notNull(),

    // Friendly label (e.g., "Main Line", "Marketing")
    label: text('label'),

    // Provider that manages this number
    provider: phoneNumberProviderEnum('provider').notNull().default('telnyx'),

    // Telnyx number ID (for release/manage via Telnyx API)
    providerNumberId: text('provider_number_id'),

    // Current status
    status: phoneNumberStatusEnum('status')
      .notNull()
      .default('pending_registration'),

    // Whether this number can make outbound calls
    supportsOutbound: boolean('supports_outbound').notNull().default(true),

    // Last time this number was used for a call (for round-robin ordering)
    lastUsedAt: timestamp('last_used_at'),

    // ISO 3166-1 alpha-2 country code (e.g., "IE", "GB", "US")
    countryCode: text('country_code'),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('idx_phone_number_org_id').on(table.organizationId)]
);

export const phoneNumberRlsPolicy = orgRlsPolicy(phoneNumber);

// Relations
export const phoneNumberRelations = relations(phoneNumber, ({ one }) => ({
  organization: one(organization, {
    fields: [phoneNumber.organizationId],
    references: [organization.id],
  }),
}));

export type PhoneNumber = typeof phoneNumber.$inferSelect;
export type NewPhoneNumber = typeof phoneNumber.$inferInsert;
