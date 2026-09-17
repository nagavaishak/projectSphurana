import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { lead } from './leads.js';
import { organization } from './organization.js';

// Import labels from enums (pure TypeScript)
import {
  paymentStatusLabels,
  paymentStatusValues,
} from '@borradh-workspace/labels';

// Re-export labels and values for consumers
export { paymentStatusLabels, paymentStatusValues };
export type { PaymentStatus } from '@borradh-workspace/labels';

// Database enum
export const paymentStatusEnum = pgEnum('payment_status', paymentStatusValues);

export const payment = pgTable(
  'payment',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    leadId: text('lead_id').references(() => lead.id, { onDelete: 'set null' }),

    // Payment details
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('eur'),
    status: paymentStatusEnum('status').notNull().default('pending'),
    description: text('description'),

    // Stripe IDs
    stripeCheckoutSessionId: text('stripe_checkout_session_id'),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    stripeConnectedAccountId: text('stripe_connected_account_id').notNull(),
    checkoutUrl: text('checkout_url'),

    // Customer info
    customerEmail: text('customer_email'),
    customerName: text('customer_name'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    // Lifecycle timestamps
    expiresAt: timestamp('expires_at'),
    paidAt: timestamp('paid_at'),
    refundedAt: timestamp('refunded_at'),

    // Standard timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_payment_org_id').on(table.organizationId),
    index('idx_payment_lead_id').on(table.leadId),
  ]
);

export const paymentRelations = relations(payment, ({ one }) => ({
  organization: one(organization, {
    fields: [payment.organizationId],
    references: [organization.id],
  }),
  lead: one(lead, {
    fields: [payment.leadId],
    references: [lead.id],
  }),
}));

export type Payment = typeof payment.$inferSelect;
export type NewPayment = typeof payment.$inferInsert;

export const paymentRlsPolicy = orgRlsPolicy(payment);
