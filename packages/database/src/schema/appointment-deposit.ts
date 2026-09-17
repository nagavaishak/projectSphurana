import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { appointment } from './appointments.js';
import { organization } from './organization.js';

// Import labels from enums (pure TypeScript)
import {
  depositStatusLabels,
  depositStatusValues,
} from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export { depositStatusLabels, depositStatusValues };
export type { DepositStatus } from '@borradh-workspace/labels';

// Database enums
export const depositStatusEnum = pgEnum('deposit_status', depositStatusValues);

export const appointmentDeposit = pgTable(
  'appointment_deposit',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    appointmentId: text('appointment_id')
      .notNull()
      .references(() => appointment.id, { onDelete: 'cascade' }),

    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    // Payment details
    amountCents: integer('amount_cents').notNull(),
    // No column default. Every writer resolves the currency explicitly (the
    // connected account's, else the org's country). A default of 'usd' was a
    // silent wrong answer waiting for a caller that forgot, in a product that
    // bills in EUR and GBP.
    currency: text('currency').notNull(),
    status: depositStatusEnum('status').notNull().default('pending'),

    // Stripe session
    stripeCheckoutSessionId: text('stripe_checkout_session_id'),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    stripeConnectedAccountId: text('stripe_connected_account_id').notNull(),

    // Link and expiration
    checkoutUrl: text('checkout_url'),
    expiresAt: timestamp('expires_at').notNull(),

    // Payment completion
    paidAt: timestamp('paid_at'),
    refundedAt: timestamp('refunded_at'),

    // Timestamps
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_appointment_deposit_appointment_id').on(table.appointmentId),
    index('idx_appointment_deposit_org_id').on(table.organizationId),
    // list-deposits: WHERE organization_id = ? ORDER BY created_at DESC.
    index('idx_appointment_deposit_org_created').on(
      table.organizationId,
      table.createdAt
    ),
    // check-expired-deposits cron: WHERE status = 'pending' AND expires_at < now.
    index('idx_appointment_deposit_status_expires').on(
      table.status,
      table.expiresAt
    ),
  ]
);

export const appointmentDepositRelations = relations(
  appointmentDeposit,
  ({ one }) => ({
    appointment: one(appointment, {
      fields: [appointmentDeposit.appointmentId],
      references: [appointment.id],
    }),
    organization: one(organization, {
      fields: [appointmentDeposit.organizationId],
      references: [organization.id],
    }),
  })
);

export const appointmentDepositRlsPolicy = orgRlsPolicy(appointmentDeposit);

export type AppointmentDeposit = typeof appointmentDeposit.$inferSelect;
export type NewAppointmentDeposit = typeof appointmentDeposit.$inferInsert;
