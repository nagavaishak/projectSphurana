import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  type AnyPgColumn,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { childOrgRlsPolicy, orgRlsPolicy } from '../rls-policy.js';
import { lead } from './leads.js';
import { organization } from './organization.js';
import { sale, saleItem } from './sale.js';
import { user } from './user.js';

// Import labels from enums (pure TypeScript)
import {
  giftCardExpiryLabels,
  giftCardExpiryValues,
  giftCardTransactionTypeLabels,
  giftCardTransactionTypeValues,
} from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export {
  giftCardTransactionTypeLabels,
  giftCardTransactionTypeValues,
  giftCardExpiryLabels,
  giftCardExpiryValues,
};
export type {
  GiftCardTransactionType,
  GiftCardExpiry,
} from '@borradh-workspace/labels';

// Database enum (gift_card_expiry stays a text column type — no pgEnum)
export const giftCardTransactionTypeEnum = pgEnum(
  'gift_card_transaction_type',
  giftCardTransactionTypeValues
);

export const giftCard = pgTable(
  'gift_card',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    // Format GC-XXXX-XXXX-XXXX, X ∈ ABCDEFGHJKMNPQRSTUVWXYZ23456789
    code: text('code').notNull(),

    initialAmountCents: integer('initial_amount_cents').notNull(),
    balanceCents: integer('balance_cents').notNull(),
    currency: text('currency').notNull().default('eur'),

    // null = never. No status column — state is derived (balance 0 = fully
    // redeemed, expiresAt < now = expired). The ledger is the source of truth.
    expiresAt: timestamp('expires_at'),

    // Purchaser/owner
    leadId: text('lead_id').references(() => lead.id, {
      onDelete: 'set null',
    }),

    // Provenance: the sale line that issued it
    saleItemId: text('sale_item_id').references(
      (): AnyPgColumn => saleItem.id,
      { onDelete: 'set null' }
    ),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('gift_card_org_code_unique').on(table.organizationId, table.code),
    index('idx_gift_card_lead_id').on(table.leadId),
  ]
);

// Append-only ledger: SUM(amount_cents) = balance_cents invariant.
// amount_cents is SIGNED — issue positive, redeem negative, adjust either.
export const giftCardTransaction = pgTable(
  'gift_card_transaction',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    giftCardId: text('gift_card_id')
      .notNull()
      .references(() => giftCard.id, { onDelete: 'cascade' }),

    type: giftCardTransactionTypeEnum('type').notNull(),
    amountCents: integer('amount_cents').notNull(),

    saleId: text('sale_id').references((): AnyPgColumn => sale.id, {
      onDelete: 'set null',
    }),
    createdById: text('created_by_id').references(() => user.id, {
      onDelete: 'set null',
    }),

    // Ledger — no updatedAt
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_gift_card_transaction_gift_card_id').on(table.giftCardId),
  ]
);

export const giftCardRelations = relations(giftCard, ({ one, many }) => ({
  organization: one(organization, {
    fields: [giftCard.organizationId],
    references: [organization.id],
  }),
  lead: one(lead, {
    fields: [giftCard.leadId],
    references: [lead.id],
  }),
  saleItem: one(saleItem, {
    fields: [giftCard.saleItemId],
    references: [saleItem.id],
  }),
  transactions: many(giftCardTransaction),
}));

export const giftCardTransactionRelations = relations(
  giftCardTransaction,
  ({ one }) => ({
    giftCard: one(giftCard, {
      fields: [giftCardTransaction.giftCardId],
      references: [giftCard.id],
    }),
    sale: one(sale, {
      fields: [giftCardTransaction.saleId],
      references: [sale.id],
    }),
    createdBy: one(user, {
      fields: [giftCardTransaction.createdById],
      references: [user.id],
    }),
  })
);

export type GiftCard = typeof giftCard.$inferSelect;
export type NewGiftCard = typeof giftCard.$inferInsert;
export type GiftCardTransaction = typeof giftCardTransaction.$inferSelect;
export type NewGiftCardTransaction = typeof giftCardTransaction.$inferInsert;

export const giftCardRlsPolicy = orgRlsPolicy(giftCard);
export const giftCardTransactionRlsPolicy = childOrgRlsPolicy(
  giftCardTransaction,
  { parent: 'gift_card', fk: 'gift_card_id' }
);
