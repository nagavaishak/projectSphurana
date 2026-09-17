import { createId } from '@paralleldrive/cuid2';
import { relations, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  index,
  integer,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { childOrgRlsPolicy, orgRlsPolicy } from '../rls-policy.js';
import { appointmentDeposit } from './appointment-deposit.js';
import { appointment } from './appointments.js';
import { giftCard } from './gift-card.js';
import { lead } from './leads.js';
import { membershipPlan } from './membership.js';
import { organizationLocation } from './organization-location.js';
import { organizationService } from './organization-service.js';
import { organization } from './organization.js';
import { practitioner } from './practitioners.js';
import { product } from './product.js';
import { user } from './user.js';

// Import labels from enums (pure TypeScript)
import {
  saleFulfilmentMethodLabels,
  saleFulfilmentMethodValues,
  saleFulfilmentStatusLabels,
  saleFulfilmentStatusValues,
  saleItemTypeLabels,
  saleItemTypeValues,
  salePaymentMethodLabels,
  salePaymentMethodValues,
  salePaymentStatusLabels,
  salePaymentStatusValues,
  saleStatusLabels,
  saleStatusValues,
  saleTipTypeLabels,
  saleTipTypeValues,
} from '@borradh-workspace/labels';
import type { GiftCardExpiry } from '@borradh-workspace/labels';

// Re-export labels and types for consumers
export {
  saleStatusLabels,
  saleStatusValues,
  saleTipTypeLabels,
  saleTipTypeValues,
  saleItemTypeLabels,
  saleItemTypeValues,
  salePaymentMethodLabels,
  salePaymentMethodValues,
  salePaymentStatusLabels,
  salePaymentStatusValues,
  saleFulfilmentMethodLabels,
  saleFulfilmentMethodValues,
  saleFulfilmentStatusLabels,
  saleFulfilmentStatusValues,
};
export type {
  SaleStatus,
  SaleTipType,
  SaleItemType,
  SalePaymentMethod,
  SalePaymentStatus,
  SaleFulfilmentMethod,
  SaleFulfilmentStatus,
} from '@borradh-workspace/labels';

// Database enums
export const saleStatusEnum = pgEnum('sale_status', saleStatusValues);
export const saleTipTypeEnum = pgEnum('sale_tip_type', saleTipTypeValues);
export const saleItemTypeEnum = pgEnum('sale_item_type', saleItemTypeValues);
export const salePaymentMethodEnum = pgEnum(
  'sale_payment_method',
  salePaymentMethodValues
);
export const salePaymentStatusEnum = pgEnum(
  'sale_payment_status',
  salePaymentStatusValues
);
export const saleFulfilmentMethodEnum = pgEnum(
  'sale_fulfilment_method',
  saleFulfilmentMethodValues
);
export const saleFulfilmentStatusEnum = pgEnum(
  'sale_fulfilment_status',
  saleFulfilmentStatusValues
);

export const sale = pgTable(
  'sale',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    // Nullable — walk-in sales have no client
    leadId: text('lead_id').references(() => lead.id, {
      onDelete: 'set null',
    }),

    locationId: text('location_id').references(() => organizationLocation.id, {
      onDelete: 'set null',
    }),

    status: saleStatusEnum('status').notNull().default('open'),

    // Money — integer cents everywhere
    subtotalCents: integer('subtotal_cents').notNull().default(0),
    tipType: saleTipTypeEnum('tip_type').notNull().default('none'),
    // 10 / 18 / 25 / custom; null when tipType !== 'percent'
    tipPercent: real('tip_percent'),
    // Final computed tip — source of truth
    tipCents: integer('tip_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull().default(0),
    // Set from currencyForCountry at creation (payment precedent)
    currency: text('currency').notNull().default('eur'),
    // Stripe's immutable tax-calculation identifier, when this sale came from
    // an online Stripe Tax checkout. The POS does not create one.
    stripeTaxCalculationId: text('stripe_tax_calculation_id'),

    // POS/till sales remain not_applicable. A paid online shop sale is a
    // collection order, and these fields keep delivery an additive state later.
    fulfilmentMethod: saleFulfilmentMethodEnum('fulfilment_method'),
    fulfilmentStatus: saleFulfilmentStatusEnum('fulfilment_status')
      .notNull()
      .default('not_applicable'),
    collectedAt: timestamp('collected_at'),
    collectedById: text('collected_by').references(() => user.id, {
      onDelete: 'set null',
    }),
    trackingReference: text('tracking_reference'),

    // Shop-only immutable checkout identity and guest-safe order access. These
    // are null on every existing till sale.
    shopCartId: text('shop_cart_id'),
    shopCheckoutSessionId: text('shop_checkout_session_id'),
    customerEmail: text('customer_email'),
    orderAccessToken: text('order_access_token'),
    orderConfirmedAt: timestamp('order_confirmed_at'),
    readyNotificationSentAt: timestamp('ready_notification_sent_at'),

    createdById: text('created_by_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),

    completedAt: timestamp('completed_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_sale_org_id').on(table.organizationId),
    index('idx_sale_lead_id').on(table.leadId),
    index('idx_sale_org_created_at').on(table.organizationId, table.createdAt),
    index('idx_sale_org_fulfilment_status').on(
      table.organizationId,
      table.fulfilmentStatus
    ),
    uniqueIndex('sale_shop_checkout_session_unique')
      .on(table.shopCheckoutSessionId)
      .where(sql`${table.shopCheckoutSessionId} is not null`),
    uniqueIndex('sale_order_access_token_unique')
      .on(table.orderAccessToken)
      .where(sql`${table.orderAccessToken} is not null`),
  ]
);

export const saleItem = pgTable(
  'sale_item',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    saleId: text('sale_id')
      .notNull()
      .references(() => sale.id, { onDelete: 'cascade' }),

    itemType: saleItemTypeEnum('item_type').notNull(),

    // Polymorphic FKs — exactly one non-null, matching itemType (enforced in
    // Zod, not a DB check).
    appointmentId: text('appointment_id').references(() => appointment.id, {
      onDelete: 'set null',
    }),
    serviceId: text('service_id').references(() => organizationService.id, {
      onDelete: 'set null',
    }),
    productId: text('product_id').references(() => product.id, {
      onDelete: 'set null',
    }),
    membershipPlanId: text('membership_plan_id').references(
      () => membershipPlan.id,
      { onDelete: 'set null' }
    ),
    // The CARD ISSUED by this line (gift-card purchase)
    giftCardId: text('gift_card_id').references(
      (): AnyPgColumn => giftCard.id,
      {
        onDelete: 'set null',
      }
    ),

    // Staff attribution for commission
    // (product.teamMemberCommissionEnabled needs it)
    practitionerId: text('practitioner_id').references(() => practitioner.id, {
      onDelete: 'set null',
    }),

    // Snapshot of item name at sale time — receipts stay stable if the
    // catalog entry is later renamed
    name: text('name').notNull(),
    quantity: integer('quantity').notNull().default(1),
    unitPriceCents: integer('unit_price_cents').notNull(),
    totalCents: integer('total_cents').notNull(),
    // Tax is a snapshot of what applied when the line was sold, rather than a
    // live lookup from the product/service. Existing and untaxed lines use 0.
    vatRateBps: integer('vat_rate_bps').notNull().default(0),
    vatAmountCents: integer('vat_amount_cents').notNull().default(0),

    // Gift-card lines only. The card's FACE VALUE, which can exceed the price
    // paid (a manual discount — sell a €50 card for €20). null on gift-card
    // lines means "face value = price paid"; null on all other line types.
    // The card is issued at completion with this face value; the sale charges
    // unitPriceCents/totalCents.
    giftCardFaceValueCents: integer('gift_card_face_value_cents'),
    // Gift-card lines only. Per-card expiry override; null falls back to the
    // org's `gift_card_expiry` default at issue time.
    giftCardExpiry: text('gift_card_expiry').$type<GiftCardExpiry>(),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('idx_sale_item_sale_id').on(table.saleId)]
);

export const salePayment = pgTable(
  'sale_payment',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    saleId: text('sale_id')
      .notNull()
      .references(() => sale.id, { onDelete: 'cascade' }),

    method: salePaymentMethodEnum('method').notNull(),
    amountCents: integer('amount_cents').notNull(),
    status: salePaymentStatusEnum('status').notNull().default('pending'),

    // Terminal + QR payments
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    // QR self-checkout: the Stripe Payment Link id, so an abandoned link can be
    // deactivated when the sale is completed/voided by another tender.
    stripePaymentLinkId: text('stripe_payment_link_id'),

    // Cumulative amount refunded against this tender (partial refunds). Full
    // refunds also flip `status` to 'refunded'; this always holds the amount so
    // reporting can net collected vs refunded without dropping the tender.
    refundedCents: integer('refunded_cents').notNull().default(0),

    // The card REDEEMED when method='gift_card'
    giftCardId: text('gift_card_id').references(
      (): AnyPgColumn => giftCard.id,
      {
        onDelete: 'set null',
      }
    ),

    // 'tap_to_pay' hint when method='card_terminal'; plain text, no pgEnum
    // (contract §7). Physical readers were removed — Tap to Pay only.
    readerType: text('reader_type').$type<'tap_to_pay'>(),

    // The already-paid deposit REDEEMED when method='deposit'. Uniquely indexed
    // (below) so a given deposit can be spent by at most one sale — re-opening a
    // sale for the same appointment cannot credit the money twice. Nullable, and
    // Postgres UNIQUE permits many NULLs, so every non-deposit tender is
    // unaffected.
    appointmentDepositId: text('appointment_deposit_id').references(
      (): AnyPgColumn => appointmentDeposit.id,
      { onDelete: 'set null' }
    ),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_sale_payment_sale_id').on(table.saleId),
    // Webhook idempotency: at most one tender per Stripe PaymentIntent, so a
    // retried/duplicate Stripe delivery can't settle two rows.
    uniqueIndex('uq_sale_payment_stripe_pi')
      .on(table.stripePaymentIntentId)
      .where(sql`${table.stripePaymentIntentId} IS NOT NULL`),
    // A paid deposit is spendable exactly once, whatever happens to the sale it
    // was credited to.
    uniqueIndex('uq_sale_payment_appointment_deposit')
      .on(table.appointmentDepositId)
      .where(sql`${table.appointmentDepositId} IS NOT NULL`),
  ]
);

export const saleRelations = relations(sale, ({ one, many }) => ({
  organization: one(organization, {
    fields: [sale.organizationId],
    references: [organization.id],
  }),
  lead: one(lead, {
    fields: [sale.leadId],
    references: [lead.id],
  }),
  location: one(organizationLocation, {
    fields: [sale.locationId],
    references: [organizationLocation.id],
  }),
  createdBy: one(user, {
    fields: [sale.createdById],
    references: [user.id],
  }),
  items: many(saleItem),
  payments: many(salePayment),
}));

export const saleItemRelations = relations(saleItem, ({ one }) => ({
  sale: one(sale, {
    fields: [saleItem.saleId],
    references: [sale.id],
  }),
  appointment: one(appointment, {
    fields: [saleItem.appointmentId],
    references: [appointment.id],
  }),
  service: one(organizationService, {
    fields: [saleItem.serviceId],
    references: [organizationService.id],
  }),
  giftCard: one(giftCard, {
    fields: [saleItem.giftCardId],
    references: [giftCard.id],
  }),
}));

export const salePaymentRelations = relations(salePayment, ({ one }) => ({
  sale: one(sale, {
    fields: [salePayment.saleId],
    references: [sale.id],
  }),
  giftCard: one(giftCard, {
    fields: [salePayment.giftCardId],
    references: [giftCard.id],
  }),
}));

export type Sale = typeof sale.$inferSelect;
export type NewSale = typeof sale.$inferInsert;
export type SaleItem = typeof saleItem.$inferSelect;
export type NewSaleItem = typeof saleItem.$inferInsert;
export type SalePayment = typeof salePayment.$inferSelect;
export type NewSalePayment = typeof salePayment.$inferInsert;

export const saleRlsPolicy = orgRlsPolicy(sale);
export const saleItemRlsPolicy = childOrgRlsPolicy(saleItem, {
  parent: 'sale',
  fk: 'sale_id',
});
export const salePaymentRlsPolicy = childOrgRlsPolicy(salePayment, {
  parent: 'sale',
  fk: 'sale_id',
});
