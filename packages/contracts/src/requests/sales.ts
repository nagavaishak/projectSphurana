/**
 * sales / checkout request CONTRACTS — the canonical, strict Zod schema for the
 * BODY of each POS write endpoint, plus the gift-card and refund bodies.
 *
 * A request contract is the wire-shaped twin of a response projection: it
 * describes exactly what the client is allowed to POST/PUT, written here in
 * pure Zod so it stays frontend-safe (no drizzle / database in the runtime
 * graph — see index.ts).
 *
 * DIRECTION OF DERIVATION — wire -> server
 * ---------------------------------------
 * This file is the SOURCE. Each `packages/features/src/sales/services/<action>/
 * <action>.schema.ts` DERIVES from it by `.extend()`ing the server-injected
 * context fields onto the base, e.g.
 *
 *     addSaleItemSchema = addSaleItemRequestBase
 *       .extend({ organizationId, saleId })
 *       .superRefine(addSaleItemRefinement)
 *
 * Because the server schema literally IS the wire schema plus fields, it can
 * never be laxer than the wire schema, and no drift is possible. Do NOT invert
 * this — a contract hand-copied from the feature schema is exactly the drift
 * this package exists to eliminate.
 *
 * BASE vs SCHEMA — why two exports
 * --------------------------------
 * A refined schema cannot be safely extended, so every contract exports a
 * matched pair:
 *
 *  - `<name>RequestBase`   — a plain `z.object({…})`. EXTENDABLE. This is what
 *    the backend feature schema extends with its context fields. It is NOT
 *    strict, because `.strict()` would reject the very fields being added.
 *  - `<name>RequestSchema` — `<name>RequestBase.strict()` (plus the shared
 *    refinement, where there is one). This is what VALIDATES a wire body:
 *    unknown fields are REJECTED, so a client sending a stale, renamed, or
 *    typo'd key fails loudly instead of having it silently stripped.
 *
 * Cross-field invariants are exported a third time, as a bare `superRefine`
 * CALLBACK (`<name>Refinement`). A refinement re-declared on the server would
 * be a second description of the same rule and could drift — which on the
 * checkout path means a body the client believes is valid meeting a server that
 * checks something subtly different. Both sides apply the one callback here.
 *
 * MONEY — units are INTEGER MINOR UNITS (cents), everywhere
 * --------------------------------------------------------
 * Every `*Cents` field on this path is an integer count of minor currency
 * units. There is no decimal/major-unit representation anywhere in the sale
 * flow — not on the wire, not in the feature schemas, not in the columns — so
 * there is no unit disagreement to reconcile. The contracts say so explicitly
 * (`.int()`) so a client that sends `12.50` fails at the boundary rather than
 * becoming 12 cents (or 1250, depending on who rounds).
 *
 * One deliberate difference, and it is a TYPE difference only: the server
 * re-declares `addSalePayment.amountCents` as the BRANDED `zCents({ positive:
 * true })` from `features/shared` (`core/branded.ts`), because the payment
 * service does `Cents` arithmetic on it. `zCents({ positive: true })` is
 * `z.number().int().positive().brand<'Cents'>()` — numerically IDENTICAL to the
 * constraint below; the brand is erased at runtime and a branded number
 * serializes as a plain number. The brand cannot live here because `contracts`
 * must not depend on `features`. If you change the numeric constraint on
 * `amountCents` in this file, change the `zCents` call in
 * `add-sale-payment.schema.ts` to match — that is the ONE money field with two
 * declarations, and it is called out here so it stays noticed.
 *
 * Context fields the SERVER injects are absent from every body contract:
 *  - `organizationId` — from the active-org session.
 *  - `createdById`    — from `@CurrentUser('id')`; a client must never be able
 *    to attribute a sale, a tender, or a gift-card adjustment to another user.
 *  - route-param ids  — `saleId`, `giftCardId`, `paymentId`, `itemId`.
 */
import {
  giftCardExpiryValues,
  saleItemTypeValues,
  salePaymentMethodValues,
  saleTipTypeValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// POST /sales — open an empty sale
// ---------------------------------------------------------------------------

/**
 * `POST /sales` body — the EXTENDABLE half.
 *
 * `leadId` is optional: the POS opens a sale for a walk-in with no client
 * (`useCreateSale` defaults its input to `{}`) and attaches the client
 * afterwards via `PUT /sales/:id/client`.
 *
 * There is deliberately NO `locationId` here. A sale is money, and the branch
 * it books to is decided by the guard-validated `X-Location-Id` header, never
 * by the body — a body field let any member of org A stamp a sale with org B's
 * location id, and let one till book its takings to another branch. Because
 * `createSaleRequestSchema` is `.strict()`, a client that still sends one now
 * gets a 400 rather than being silently ignored.
 *
 * `organizationId`, `createdById` and `locationId` are all server-injected and
 * therefore absent.
 */
export const createSaleRequestBase = z.object({
  leadId: z.string().min(1).optional(),
});

/** `POST /sales` body — the VALIDATING half. */
export const createSaleRequestSchema = createSaleRequestBase.strict();

export type CreateSaleRequest = z.infer<typeof createSaleRequestSchema>;

// ---------------------------------------------------------------------------
// POST /sales/from-appointment — open a sale seeded from a booking
// ---------------------------------------------------------------------------

/**
 * `POST /sales/from-appointment` body — the EXTENDABLE half.
 *
 * The only client-supplied field is the appointment. The server derives the
 * client and prices the lines from the booking's snapshot prices, which is why
 * no amounts appear here: a client cannot propose what an appointment costs.
 */
export const createSaleFromAppointmentRequestBase = z.object({
  appointmentId: z.string().min(1),
});

/** `POST /sales/from-appointment` body — the VALIDATING half. */
export const createSaleFromAppointmentRequestSchema =
  createSaleFromAppointmentRequestBase.strict();

export type CreateSaleFromAppointmentRequest = z.infer<
  typeof createSaleFromAppointmentRequestSchema
>;

// ---------------------------------------------------------------------------
// POST /sales/:id/items — add a line to an open sale
// ---------------------------------------------------------------------------

/**
 * `POST /sales/:id/items` body — the EXTENDABLE half.
 *
 * `unitPriceCents` is an integer count of minor units and may be `0` (a comped
 * line is legitimate); `quantity` is a positive integer defaulting to `1`. Note
 * that `.default(1)` MATERIALISES — a parsed body always carries `quantity`,
 * even when the caller omitted it.
 *
 * The `giftCard*` fields apply to gift-card lines only and are rejected on any
 * other line type — see {@link addSaleItemRefinement}, which also enforces the
 * polymorphic-FK rule (exactly one reference, matching `itemType`; none at all
 * for `gift_card` and `manual`).
 *
 * This is also how a gift card is CREATED: there is no `POST /gift-cards`. A
 * `gift_card` line on a sale issues the card when the sale completes, which is
 * why the face value and expiry override live on the line, not on a card body.
 *
 * `saleId` is the route param and `organizationId` is session context, so
 * neither appears in the body.
 */
export const addSaleItemRequestBase = z.object({
  itemType: z.enum(saleItemTypeValues),
  appointmentId: z.string().min(1).optional(),
  serviceId: z.string().min(1).optional(),
  productId: z.string().min(1).optional(),
  membershipPlanId: z.string().min(1).optional(),
  practitionerId: z.string().min(1).optional(),
  name: z.string().min(1),
  quantity: z.number().int().min(1).default(1),
  /** Integer minor units. `0` is allowed — a comped line is not an error. */
  unitPriceCents: z.number().int().min(0),
  // Gift-card lines only: the card's face value (defaults to the price paid)
  // and a per-card expiry override (defaults to the org setting).
  giftCardFaceValueCents: z.number().int().min(0).optional(),
  giftCardExpiry: z.enum(giftCardExpiryValues).optional(),
});

/**
 * The cross-field rules for an add-line body, exported as a bare `superRefine`
 * callback so the wire schema and the derived server schema apply the SAME
 * check rather than two copies of it.
 *
 * Two invariants:
 *  1. `giftCardFaceValueCents` / `giftCardExpiry` are gift-card-only. Accepting
 *     a face value on, say, a product line would silently mint value that
 *     nothing paid for.
 *  2. Exactly one polymorphic FK is set and it matches `itemType`. `gift_card`
 *     and `manual` lines carry NO reference (a gift card is issued at sale
 *     completion; a manual line is a free-text ad-hoc amount).
 *
 * The parameter is typed as the BASE's output, which is a subset of the
 * extended server object's — so the same callback type-checks on both.
 */
export const addSaleItemRefinement = (
  v: z.output<typeof addSaleItemRequestBase>,
  ctx: z.RefinementCtx
): void => {
  // Gift-card-only fields: reject on any other line type.
  if (v.itemType !== 'gift_card') {
    if (v.giftCardFaceValueCents !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['giftCardFaceValueCents'],
        message: 'Face value is only valid on gift-card lines',
      });
    }
    if (v.giftCardExpiry !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['giftCardExpiry'],
        message: 'Expiry override is only valid on gift-card lines',
      });
    }
  }

  // Exactly one polymorphic FK must be set, matching itemType.
  // Gift-card and manual lines carry no FK — a gift card is issued at sale
  // completion; a manual line is a free-text ad-hoc amount (quick payment).
  const fkByType: Record<string, string | undefined> = {
    appointment: v.appointmentId,
    service: v.serviceId,
    product: v.productId,
    membership: v.membershipPlanId,
  };
  const provided = [
    v.appointmentId,
    v.serviceId,
    v.productId,
    v.membershipPlanId,
  ].filter(Boolean);

  if (v.itemType === 'gift_card' || v.itemType === 'manual') {
    if (provided.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${v.itemType} lines must not reference another entity`,
      });
    }
    return;
  }

  if (provided.length !== 1 || !fkByType[v.itemType]) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Exactly the ${v.itemType} reference must be set for item type '${v.itemType}'`,
    });
  }
};

/** `POST /sales/:id/items` body — the VALIDATING half (strict + refined). */
export const addSaleItemRequestSchema = addSaleItemRequestBase
  .strict()
  .superRefine(addSaleItemRefinement);

export type AddSaleItemRequest = z.infer<typeof addSaleItemRequestSchema>;

// ---------------------------------------------------------------------------
// PUT /sales/:id/tip — set (or replace) the tip on an open sale
// ---------------------------------------------------------------------------

/**
 * `PUT /sales/:id/tip` body — the EXTENDABLE half.
 *
 * `tipPercent` is a PERCENT (0–100), not a fraction — `18` means 18%. The
 * frontend's 10/18/25 presets and a custom entry are stored identically.
 * `tipAmountCents` is integer minor units. Which of the two is required depends
 * on `tipType`; see {@link setSaleTipRefinement}.
 */
export const setSaleTipRequestBase = z.object({
  tipType: z.enum(saleTipTypeValues),
  // Only for tipType='percent' — 10/18/25 presets and custom are stored
  // identically (presets are frontend constants)
  tipPercent: z.number().min(0).max(100).optional(),
  // Only for tipType='amount'
  tipAmountCents: z.number().int().min(0).optional(),
});

/**
 * Requires the field that matches `tipType`. Shared verbatim with the server
 * schema so "percent tip with no percent" cannot mean different things on the
 * two sides of the wire.
 */
export const setSaleTipRefinement = (
  v: z.output<typeof setSaleTipRequestBase>,
  ctx: z.RefinementCtx
): void => {
  if (v.tipType === 'percent' && v.tipPercent === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'tipPercent is required when tipType is percent',
    });
  }
  if (v.tipType === 'amount' && v.tipAmountCents === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'tipAmountCents is required when tipType is amount',
    });
  }
};

/** `PUT /sales/:id/tip` body — the VALIDATING half (strict + refined). */
export const setSaleTipRequestSchema = setSaleTipRequestBase
  .strict()
  .superRefine(setSaleTipRefinement);

export type SetSaleTipRequest = z.infer<typeof setSaleTipRequestSchema>;

// ---------------------------------------------------------------------------
// PUT /sales/:id/client — attach or clear the client on an open sale
// ---------------------------------------------------------------------------

/**
 * `PUT /sales/:id/client` body — the EXTENDABLE half.
 *
 * `leadId` is NULLABLE but NOT optional: `null` explicitly clears the client
 * (walk-in), and omitting the key is an error rather than a silent no-op —
 * "clear the client" and "I forgot to send a client" must not look the same on
 * a sale that is about to take money.
 */
export const setSaleClientRequestBase = z.object({
  // The lead to attach to the sale. `null` clears it (walk-in).
  leadId: z.string().min(1).nullable(),
});

/** `PUT /sales/:id/client` body — the VALIDATING half. */
export const setSaleClientRequestSchema = setSaleClientRequestBase.strict();

export type SetSaleClientRequest = z.infer<typeof setSaleClientRequestSchema>;

// ---------------------------------------------------------------------------
// POST /sales/:id/payments — record a tender (this is the money endpoint)
// ---------------------------------------------------------------------------

/**
 * `POST /sales/:id/payments` body — the EXTENDABLE half.
 *
 * This is the endpoint that moves money, so read the constraints literally:
 *
 *  - `amountCents` is a STRICTLY POSITIVE integer count of minor units. Zero
 *    and negative tenders are rejected: a refund is not a negative payment on
 *    this endpoint. The server re-declares this field as the branded
 *    `zCents({ positive: true })` for `Cents` arithmetic — same numeric
 *    constraint plus a compile-time brand that cannot live in this package.
 *    See the money note in the file header.
 *  - `giftCardCode` is how a card is REDEEMED (the POS scans/types it); it is
 *    required exactly when `method === 'gift_card'`. There is no separate
 *    redeem endpoint — redemption is a gift-card TENDER on a sale.
 *  - `autoComplete` defaults to `true`: a sync tender (cash / gift card) that
 *    fully covers the sale completes it in the same call. The interactive
 *    checkout passes `false` so the operator confirms manually. Because
 *    `.default(true)` MATERIALISES, a parsed body always carries the key; do
 *    not "simplify" the default away, since the feature schema IS this object
 *    and dropping it would change SERVER behaviour for quick payment and for
 *    webhook-driven tenders.
 *
 * `createdById` is deliberately absent: the controller stamps it from the
 * session, so a tender can never be attributed to another operator.
 */
export const addSalePaymentRequestBase = z.object({
  method: z.enum(salePaymentMethodValues),
  /**
   * Integer minor units, strictly positive. The server parses the same field
   * through `zCents({ positive: true })` to brand it as `Cents`.
   */
  amountCents: z.number().int().positive(),
  // Redeeming a gift card: identify the card by code (POS scans/types it)
  giftCardCode: z.string().min(1).optional(),
  // 'tap_to_pay' hint when method='card_terminal'
  readerType: z.enum(['tap_to_pay']).optional(),
  // When a sync tender (cash / gift card) fully covers the sale, whether to
  // complete it in the same call. Defaults to true (quick payment, webhooks).
  // The interactive checkout passes false so the operator confirms manually.
  autoComplete: z.boolean().optional().default(true),
});

/**
 * Tender cross-field rules, shared with the server schema.
 *
 * A gift-card tender without a code would otherwise reach the service and fail
 * late; a `readerType` on a non-terminal method is a caller bug that must not
 * be silently ignored on a payment body.
 */
export const addSalePaymentRefinement = (
  v: z.output<typeof addSalePaymentRequestBase>,
  ctx: z.RefinementCtx
): void => {
  if (v.method === 'gift_card' && !v.giftCardCode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'giftCardCode is required when method is gift_card',
    });
  }
  if (v.readerType && v.method !== 'card_terminal') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'readerType only applies to card_terminal payments',
    });
  }
};

/** `POST /sales/:id/payments` body — the VALIDATING half (strict + refined). */
export const addSalePaymentRequestSchema = addSalePaymentRequestBase
  .strict()
  .superRefine(addSalePaymentRefinement);

export type AddSalePaymentRequest = z.infer<typeof addSalePaymentRequestSchema>;

// ---------------------------------------------------------------------------
// POST /gift-cards/:id/adjust — top up or reduce a card's balance
// ---------------------------------------------------------------------------

/**
 * `POST /gift-cards/:id/adjust` body — the EXTENDABLE half.
 *
 * `amountCents` here is SIGNED, unlike every other money field on this path:
 * positive tops the card up, negative reduces the balance. Zero is rejected —
 * a no-op adjustment would write a meaningless ledger row. It is deliberately
 * NOT `zCents`, which forbids negatives.
 *
 * `giftCardId` is the route param and `createdById` is session context, so
 * neither appears in the body.
 */
export const adjustGiftCardRequestBase = z.object({
  // Signed — positive tops the card up, negative reduces the balance
  amountCents: z
    .number()
    .int()
    .refine((v) => v !== 0, { message: 'Adjustment cannot be zero' }),
  reason: z.string().min(1).optional(),
});

/** `POST /gift-cards/:id/adjust` body — the VALIDATING half. */
export const adjustGiftCardRequestSchema = adjustGiftCardRequestBase.strict();

export type AdjustGiftCardRequest = z.infer<typeof adjustGiftCardRequestSchema>;

// ---------------------------------------------------------------------------
// POST /payments/:id/refund — refund a captured Stripe payment
// ---------------------------------------------------------------------------

/**
 * `POST /payments/:id/refund` body — the EXTENDABLE half.
 *
 * There is no amount here: the endpoint refunds the payment in FULL and the
 * payment is identified by the route param. A client cannot propose a refund
 * amount, which is the safest possible shape for this body — do not add one
 * without a corresponding server-side cap.
 *
 * `reason` is Stripe's refund-reason vocabulary, kept as an inline enum because
 * it is Stripe's and not ours (there is no `@borradh-workspace/labels` record
 * for it).
 */
export const refundPaymentRequestBase = z.object({
  reason: z
    .enum(['requested_by_customer', 'duplicate', 'fraudulent'])
    .optional(),
});

/** `POST /payments/:id/refund` body — the VALIDATING half. */
export const refundPaymentRequestSchema = refundPaymentRequestBase.strict();

export type RefundPaymentRequest = z.infer<typeof refundPaymentRequestSchema>;
