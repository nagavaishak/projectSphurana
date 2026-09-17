import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { organization } from './organization.js';

// ─────────────────────────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────────────────────────

// Import labels from enums (pure TypeScript)
import {
  creditChannelLabels,
  creditChannelValues,
  creditTransactionTypeLabels,
  creditTransactionTypeValues,
  invoiceStatusLabels,
  invoiceStatusValues,
  subscriptionStatusLabels,
  subscriptionStatusValues,
} from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export {
  subscriptionStatusLabels,
  subscriptionStatusValues,
  creditTransactionTypeLabels,
  creditTransactionTypeValues,
  creditChannelLabels,
  creditChannelValues,
  invoiceStatusLabels,
  invoiceStatusValues,
};
export type {
  SubscriptionStatus,
  CreditTransactionType,
  CreditChannel,
  InvoiceStatus,
} from '@borradh-workspace/labels';

// Database enums
export const subscriptionStatusEnum = pgEnum(
  'subscription_status',
  subscriptionStatusValues
);
export const creditTransactionTypeEnum = pgEnum(
  'credit_transaction_type',
  creditTransactionTypeValues
);
export const creditChannelEnum = pgEnum('credit_channel', creditChannelValues);
export const invoiceStatusEnum = pgEnum('invoice_status', invoiceStatusValues);

// ─────────────────────────────────────────────────────────────────
// SUBSCRIPTIONS
// ─────────────────────────────────────────────────────────────────

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' })
    .unique(),
  stripeCustomerId: text('stripe_customer_id').notNull(),
  stripeSubscriptionId: text('stripe_subscription_id').unique(),
  stripePriceId: text('stripe_price_id'),
  status: subscriptionStatusEnum('status').notNull().default('incomplete'),
  planId: text('plan_id').notNull().default('pro'),
  currentPeriodStart: timestamp('current_period_start'),
  currentPeriodEnd: timestamp('current_period_end'),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  canceledAt: timestamp('canceled_at'),
  endedAt: timestamp('ended_at'),
  trialStart: timestamp('trial_start'),
  trialEnd: timestamp('trial_end'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ─────────────────────────────────────────────────────────────────
// CREDIT BALANCES
// ─────────────────────────────────────────────────────────────────

export const creditBalances = pgTable('credit_balances', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' })
    .unique(),
  // Credits stored with precision (actual credits * 100)
  balance: integer('balance').notNull().default(0),
  // Monthly included credits from subscription (in precision units)
  includedCredits: integer('included_credits').notNull().default(100000),
  // Auto-refill settings
  autoRefillEnabled: boolean('auto_refill_enabled').notNull().default(false),
  autoRefillThreshold: integer('auto_refill_threshold').default(10000), // 100 credits
  autoRefillPackageId: text('auto_refill_package_id'),
  // Low balance notification settings
  lowBalanceAlertThreshold: integer('low_balance_alert_threshold').default(
    20000
  ), // 200 credits
  lowBalanceAlertSent: boolean('low_balance_alert_sent')
    .notNull()
    .default(false),
  // Timestamps
  lastRefillAt: timestamp('last_refill_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ─────────────────────────────────────────────────────────────────
// CREDIT TRANSACTIONS
// ─────────────────────────────────────────────────────────────────

export const creditTransactions = pgTable(
  'credit_transactions',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    type: creditTransactionTypeEnum('type').notNull(),
    // Amount in precision units (positive for additions, negative for usage)
    amount: integer('amount').notNull(),
    // Balance after this transaction
    balanceAfter: integer('balance_after').notNull(),
    // For usage transactions
    channel: creditChannelEnum('channel'),
    // Reference to what caused this transaction
    referenceId: text('reference_id'), // e.g., message ID, call ID, checkout session ID
    referenceType: text('reference_type'), // e.g., 'sms_message', 'voice_call', 'stripe_checkout'
    // Additional context
    description: text('description'),
    metadata: text('metadata'), // JSON string for additional data
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [index('idx_credit_transaction_org_id').on(table.organizationId)]
);

// ─────────────────────────────────────────────────────────────────
// INVOICES (Synced from Stripe)
// ─────────────────────────────────────────────────────────────────

export const invoices = pgTable(
  'invoices',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    stripeInvoiceId: text('stripe_invoice_id').notNull().unique(),
    stripeCustomerId: text('stripe_customer_id').notNull(),
    subscriptionId: text('subscription_id').references(() => subscriptions.id, {
      onDelete: 'set null',
    }),
    status: invoiceStatusEnum('status').notNull(),
    // Amounts in cents
    amountDue: integer('amount_due').notNull(),
    amountPaid: integer('amount_paid').notNull().default(0),
    currency: text('currency').notNull().default('usd'),
    // URLs
    hostedInvoiceUrl: text('hosted_invoice_url'),
    invoicePdf: text('invoice_pdf'),
    // Dates
    periodStart: timestamp('period_start'),
    periodEnd: timestamp('period_end'),
    dueDate: timestamp('due_date'),
    paidAt: timestamp('paid_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_invoice_org_id').on(table.organizationId),
    index('idx_invoice_subscription_id').on(table.subscriptionId),
  ]
);

// ─────────────────────────────────────────────────────────────────
// RELATIONS
// ─────────────────────────────────────────────────────────────────

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  organization: one(organization, {
    fields: [subscriptions.organizationId],
    references: [organization.id],
  }),
}));

export const creditBalancesRelations = relations(creditBalances, ({ one }) => ({
  organization: one(organization, {
    fields: [creditBalances.organizationId],
    references: [organization.id],
  }),
}));

export const creditTransactionsRelations = relations(
  creditTransactions,
  ({ one }) => ({
    organization: one(organization, {
      fields: [creditTransactions.organizationId],
      references: [organization.id],
    }),
  })
);

export const invoicesRelations = relations(invoices, ({ one }) => ({
  organization: one(organization, {
    fields: [invoices.organizationId],
    references: [organization.id],
  }),
  subscription: one(subscriptions, {
    fields: [invoices.subscriptionId],
    references: [subscriptions.id],
  }),
}));

// ─────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;

export type CreditBalance = typeof creditBalances.$inferSelect;
export type NewCreditBalance = typeof creditBalances.$inferInsert;

export type CreditTransaction = typeof creditTransactions.$inferSelect;
export type NewCreditTransaction = typeof creditTransactions.$inferInsert;

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;

// ─────────────────────────────────────────────────────────────────
// RLS POLICIES
// ─────────────────────────────────────────────────────────────────

export const subscriptionsRlsPolicy = orgRlsPolicy(subscriptions);
export const creditBalancesRlsPolicy = orgRlsPolicy(creditBalances);
export const creditTransactionsRlsPolicy = orgRlsPolicy(creditTransactions);
export const invoicesRlsPolicy = orgRlsPolicy(invoices);
