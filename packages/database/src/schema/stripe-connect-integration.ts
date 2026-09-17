import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { organization } from './organization.js';
import { user } from './user.js';

export const stripeConnectIntegration = pgTable(
  'stripe_connect_integration',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    organizationId: text('organization_id')
      .notNull()
      .unique()
      .references(() => organization.id, { onDelete: 'cascade' }),

    connectedById: text('connected_by_id').references(() => user.id, {
      onDelete: 'set null',
    }),

    // Stripe Connect account details.
    //
    // UNIQUE, and the uniqueness is load-bearing rather than tidy: it is the
    // only thing that can stop two organizations backing their payments with
    // ONE Stripe account. The application-level guard in linkStripeAccount
    // reads the account's Stripe metadata and cannot be atomic — two concurrent
    // links for the same acct_ can both see "unclaimed" before either claims —
    // and a cross-org SELECT is not available to close the window, because RLS
    // hides the other organization's row from the request path by design.
    // A constraint is enforced whether or not the conflicting row is visible.
    stripeAccountId: text('stripe_account_id').notNull().unique(), // acct_xxx
    accountName: text('account_name'),
    accountEmail: text('account_email'),

    // How this account came to be connected. Plain text + $type (adAreaType
    // precedent) — internal discriminator, no pgEnum/label record.
    //
    //   'standard_oauth'  — LEGACY. A Standard account connected by the owner
    //     through the in-product OAuth redirect, managed from the Integrations
    //     screen. No new rows get this value.
    //   'standard_linked' — a Standard account the merchant onboarded on their
    //     own (self-serve OAuth link sent after a sales call) and an operator
    //     attached by pasting its acct_ id. Mechanically identical to the
    //     above — it has an OAuth grant to revoke — but it is NOT legacy, and
    //     conflating the two put every newly onboarded merchant behind a
    //     "connected via the legacy integration" notice instead of their real
    //     charges and payouts status.
    //   'controller'      — created by us for embedded onboarding.
    accountType: text('account_type')
      .$type<'standard_oauth' | 'standard_linked' | 'controller'>()
      .notNull()
      .default('standard_oauth'),

    // Account status (from Stripe)
    chargesEnabled: boolean('charges_enabled').notNull().default(false),
    payoutsEnabled: boolean('payouts_enabled').notNull().default(false),
    detailsSubmitted: boolean('details_submitted').notNull().default(false),

    // Mirrors of `account.requirements` from account.updated webhooks
    requirementsCurrentlyDue: jsonb('requirements_currently_due').$type<
      string[]
    >(),
    disabledReason: text('disabled_reason'),

    // Settings
    isActive: boolean('is_active').notNull().default(true),
    defaultCurrency: text('default_currency'), // e.g. 'eur', 'usd', 'gbp'
    // `defaultDepositAmountCents` and `depositExpirationHours` used to live here.
    // The first was written at connect time and never read by anything; the
    // second is now `organization.holdExpirationHours`, because how long a slot
    // is held is a booking policy, not a property of the payment processor — a
    // clinic with no Stripe account still needs one.

    // Timestamps
    lastSyncAt: timestamp('last_sync_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_stripe_connect_connected_by_id').on(table.connectedById),
  ]
);

export const stripeConnectIntegrationRelations = relations(
  stripeConnectIntegration,
  ({ one }) => ({
    organization: one(organization, {
      fields: [stripeConnectIntegration.organizationId],
      references: [organization.id],
    }),
    connectedBy: one(user, {
      fields: [stripeConnectIntegration.connectedById],
      references: [user.id],
    }),
  })
);

export type StripeConnectIntegration =
  typeof stripeConnectIntegration.$inferSelect;
export type NewStripeConnectIntegration =
  typeof stripeConnectIntegration.$inferInsert;

export const stripeConnectIntegrationRlsPolicy = orgRlsPolicy(
  stripeConnectIntegration
);
