import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { organization } from './organization.js';
import { user } from './user.js';

/**
 * Transient row created during the WhatsApp connect funnel.
 *
 * The OAuth callback stashes a pending row holding the token plus the
 * available WABAs and phone numbers fetched from Meta. The /connect/whatsapp
 * funnel reads this row, walks the user through selection + page linking,
 * then calls `finalizeWhatsAppConnection` which moves the chosen WABA +
 * phone into `whatsappAccount` and deletes this row.
 *
 * One row per org max — any prior pending row is replaced on a new OAuth
 * start so abandoned attempts don't pile up.
 */
export const whatsappPendingConnection = pgTable(
  'whatsapp_pending_connection',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    organizationId: text('organization_id')
      .notNull()
      .unique()
      .references(() => organization.id, { onDelete: 'cascade' }),
    initiatedById: text('initiated_by_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    encryptedCredentials: text('encrypted_credentials').notNull(),

    availableWabas: jsonb('available_wabas')
      .$type<Array<{ id: string; name: string }>>()
      .notNull(),
    availablePhoneNumbers: jsonb('available_phone_numbers')
      .$type<
        Array<{
          id: string;
          wabaId: string;
          displayPhoneNumber: string;
          verifiedName: string;
          qualityRating: string;
          codeVerificationStatus: string;
        }>
      >()
      .notNull(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  }
);

export const whatsappPendingConnectionRlsPolicy = orgRlsPolicy(
  whatsappPendingConnection
);

export const whatsappPendingConnectionRelations = relations(
  whatsappPendingConnection,
  ({ one }) => ({
    organization: one(organization, {
      fields: [whatsappPendingConnection.organizationId],
      references: [organization.id],
    }),
    initiatedBy: one(user, {
      fields: [whatsappPendingConnection.initiatedById],
      references: [user.id],
    }),
  })
);

export type WhatsAppPendingConnection =
  typeof whatsappPendingConnection.$inferSelect;
export type NewWhatsAppPendingConnection =
  typeof whatsappPendingConnection.$inferInsert;
