/**
 * Sales / POS response PROJECTIONS — hand-composed from generated atoms.
 *
 * Covers the sales (POS checkout), payments (deposit links), and gift-card
 * response surfaces. Atoms are 1:1 with a DB table; the projections here are the
 * real API contract: list wrappers, detail shapes with joined line items /
 * client / payments, computed daily summaries, and tender-specific extras.
 *
 * Pure Zod, composed only with `z.object` / `.extend` / `z.array` / `z.record`.
 * Money is integer cents on the wire (`z.number()`); dates are ISO strings
 * (atoms already wire-shaped). See ./leads.ts for the pattern.
 */
import { giftCardExpiryValues } from '@borradh-workspace/labels';
import { z } from 'zod';
import {
  giftCardAtomSchema,
  giftCardTransactionAtomSchema,
  paymentAtomSchema,
  saleAtomSchema,
  saleItemAtomSchema,
  salePaymentAtomSchema,
} from '../generated/index.js';

// ============================================================================
// SALES — entities (atoms exposed under contract names)
// ============================================================================

/** A sale header row (the atom, verbatim) as returned by create/complete/void. */
export const saleSchema = saleAtomSchema;
export type Sale = z.infer<typeof saleSchema>;

/**
 * A single line item on a sale (service, product, membership, gift card).
 *
 * `giftCardExpiry` is a typed text column (`$type<GiftCardExpiry>`) that the
 * generator widens to `z.string()`; narrow it back here to the enum so the
 * contract matches the DB/backend type.
 */
export const saleItemSchema = saleItemAtomSchema.extend({
  giftCardExpiry: z.enum(giftCardExpiryValues).nullable(),
});
export type SaleItem = z.infer<typeof saleItemSchema>;

/**
 * A tender (payment) recorded against a sale.
 *
 * `readerType` is a typed text column (`$type<'tap_to_pay'>`) that the generator
 * widens to `z.string()`; narrow it back here to match the DB/contract type.
 */
export const salePaymentSchema = salePaymentAtomSchema.extend({
  readerType: z.literal('tap_to_pay').nullable(),
});
export type SalePayment = z.infer<typeof salePaymentSchema>;

// ============================================================================
// SALES — joined/computed refs attached to a sale (not their own tables)
// ============================================================================

/** Minimal client snapshot attached to a sale for list/detail rendering. */
export const saleLeadRefSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});
export type SaleLeadRef = z.infer<typeof saleLeadRefSchema>;

/** Minimal location snapshot attached to a sale. */
export const saleLocationRefSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
});
export type SaleLocationRef = z.infer<typeof saleLocationRefSchema>;

/** Minimal creator (team member) snapshot attached to a sale. */
export const saleUserRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
});
export type SaleUserRef = z.infer<typeof saleUserRefSchema>;

// ============================================================================
// SALES — detail / list projections (the nested contract)
// ============================================================================

/**
 * A sale with its line items and tenders, plus the optionally-loaded client,
 * location and creator relations. `lead`/`location`/`createdBy` are optional:
 * not every code path that builds this shape loads the relation.
 */
export const saleWithRelationsSchema = saleAtomSchema.extend({
  items: z.array(saleItemSchema),
  payments: z.array(salePaymentSchema),
  lead: saleLeadRefSchema.nullable().optional(),
  location: saleLocationRefSchema.nullable().optional(),
  createdBy: saleUserRefSchema.nullable().optional(),
});
export type SaleWithRelations = z.infer<typeof saleWithRelationsSchema>;

/** `GET /sales` — list projection: `{ items, total, limit, offset }`. */
export const saleListResponseSchema = z.object({
  items: z.array(saleWithRelationsSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export type SaleListResponse = z.infer<typeof saleListResponseSchema>;

/**
 * `POST /sales/:id/payments` — the sale (with relations) plus tender-specific
 * extras returned only for processed tenders (QR self-checkout, card terminal,
 * manual card entry). All optional; a cash/gift-card tender returns none.
 */
export const addSalePaymentResponseSchema = saleWithRelationsSchema.extend({
  /** QR self-checkout: the Stripe Payment Link URL to render as a QR code. */
  paymentLinkUrl: z.string().optional(),
  /** Card-terminal: PaymentIntent client secret for reader collect/confirm. */
  terminalClientSecret: z.string().optional(),
  /** Manual card entry: PaymentIntent client secret confirmed via Elements. */
  cardClientSecret: z.string().optional(),
  /** Connected account the client secret belongs to. */
  connectedAccountId: z.string().optional(),
  /** Manual card entry: the pending `sale_payment` row id to settle. */
  salePaymentId: z.string().optional(),
});
export type AddSalePaymentResponse = z.infer<
  typeof addSalePaymentResponseSchema
>;

// ============================================================================
// SALES — daily summary (computed aggregate, no backing table)
// ============================================================================

/** One row of the daily transaction summary (per item type). */
export const saleDailySummaryItemRowSchema = z.object({
  salesQty: z.number(),
  refundQty: z.number(),
  grossCents: z.number(),
});
export type SaleDailySummaryItemRow = z.infer<
  typeof saleDailySummaryItemRowSchema
>;

/** One row of the daily cash-movement summary (per payment method). */
export const saleDailySummaryMethodRowSchema = z.object({
  collectedCents: z.number(),
  refundsCents: z.number(),
});
export type SaleDailySummaryMethodRow = z.infer<
  typeof saleDailySummaryMethodRowSchema
>;

/** `GET /sales/daily-summary` — aggregated daily POS summary (completed sales). */
export const saleDailySummarySchema = z.object({
  date: z.string(),
  currency: z.string(),
  saleCount: z.number(),
  totalCents: z.number(),
  tipCents: z.number(),
  /** Succeeded tender totals keyed by payment method. */
  byMethod: z.record(z.string(), z.number()),
  /** Line totals keyed by item type. */
  byItemType: z.record(z.string(), z.number()),
  /** Transaction summary rows keyed by item type (qty + gross). */
  itemRows: z.record(z.string(), saleDailySummaryItemRowSchema),
  /** Cash-movement rows keyed by payment method (collected + refunds). */
  methodRows: z.record(z.string(), saleDailySummaryMethodRowSchema),
});
export type SaleDailySummary = z.infer<typeof saleDailySummarySchema>;

// ============================================================================
// PAYMENTS — deposit / checkout payment links
// ============================================================================

/** A payment (deposit / checkout link) row — the atom, verbatim. */
export const paymentSchema = paymentAtomSchema;
export type Payment = z.infer<typeof paymentSchema>;

/** `GET /payments` — paginated list of payments. */
export const paymentListResponseSchema = z.object({
  items: z.array(paymentSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export type PaymentListResponse = z.infer<typeof paymentListResponseSchema>;

/** `POST /payments` — the created payment plus its hosted checkout URL. */
export const createPaymentResponseSchema = z.object({
  payment: paymentSchema,
  checkoutUrl: z.string(),
});
export type CreatePaymentResponse = z.infer<typeof createPaymentResponseSchema>;

/** `POST /payments/:id/refund` — the updated payment plus the Stripe refund id. */
export const refundPaymentResponseSchema = z.object({
  payment: paymentSchema,
  refundId: z.string(),
});
export type RefundPaymentResponse = z.infer<typeof refundPaymentResponseSchema>;

// ============================================================================
// GIFT CARDS
// ============================================================================

/** A gift card row (balance, code, expiry) — the atom, verbatim. */
export const giftCardSchema = giftCardAtomSchema;
export type GiftCard = z.infer<typeof giftCardSchema>;

/** A single ledger entry against a gift card (issue / redeem / adjust). */
export const giftCardTransactionSchema = giftCardTransactionAtomSchema;
export type GiftCardTransaction = z.infer<typeof giftCardTransactionSchema>;

/** `GET /gift-cards/:id` — a gift card with its transaction ledger. */
export const giftCardWithTransactionsSchema = giftCardAtomSchema.extend({
  transactions: z.array(giftCardTransactionSchema),
});
export type GiftCardWithTransactions = z.infer<
  typeof giftCardWithTransactionsSchema
>;

/** `GET /gift-cards` — list projection: `{ items, total, limit, offset }`. */
export const giftCardListResponseSchema = z.object({
  items: z.array(giftCardSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export type GiftCardListResponse = z.infer<typeof giftCardListResponseSchema>;
