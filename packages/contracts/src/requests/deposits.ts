/**
 * deposits request CONTRACTS — the canonical, strict Zod schema for the BODY of
 * each deposit write endpoint.
 *
 * These bodies MOVE REAL MONEY: `POST /deposits` opens a Stripe Connect
 * checkout for `amountCents`, and `POST /deposits/:id/refund` sends money back.
 * Every constraint below is lifted VERBATIM from the feature schema it now
 * feeds; nothing here was widened to make a caller parse. If a constraint looks
 * surprising, it is deliberate — tighten it in this file (both halves move
 * together) rather than working around it at a call site.
 *
 * DIRECTION OF DERIVATION — wire -> server
 * ---------------------------------------
 * This file is the SOURCE. The feature schemas DERIVE from it by `.extend()`ing
 * the server-injected context fields onto the base:
 *
 *   packages/features/src/appointments/services/create-deposit-request/
 *     createDepositRequestSchema = createDepositRequestBase.extend({ organizationId })
 *   packages/features/src/appointments/services/refund-deposit/
 *     refundDepositSchema = refundDepositRequestBase.extend({ depositId, organizationId })
 *
 * Because each server schema literally IS the wire schema plus fields, it can
 * never be laxer than the wire schema, and no drift is possible. Do NOT invert
 * this — a contract hand-copied from the feature schema is exactly the drift
 * this package exists to eliminate.
 *
 * BASE vs SCHEMA — why two exports
 * --------------------------------
 * `.refine()` returns a `ZodEffects`, which has NO `.extend()`. So every
 * contract file exports a matched pair:
 *
 *  - `<name>RequestBase`   — a plain `z.object({…})`. EXTENDABLE. This is what
 *    the backend feature schema extends with its context fields. It is NOT
 *    strict, because `.strict()` would reject the very fields being added.
 *  - `<name>RequestSchema` — `<name>RequestBase.strict()`. This is what
 *    VALIDATES a wire body: unknown fields are REJECTED, so a client sending a
 *    stale, renamed, or typo'd key fails loudly instead of having it silently
 *    stripped by a permissive `z.object`.
 *
 * Context fields the SERVER injects are absent from both body contracts:
 *  - `organizationId` — from the active-org session, never sent by the client.
 *  - `depositId`      — the `:id` route param on the refund endpoint.
 */
import { z } from 'zod';
import { externalRedirectUrl } from './redirect-url.js';

/**
 * `POST /deposits` body — the EXTENDABLE half.
 *
 * MONEY. `amountCents` is INTEGER MINOR UNITS (cents/pence), never a decimal
 * major-unit amount: `z.number().int().positive()` rejects `19.99` outright, so
 * a caller that forgets to multiply by 100 fails at the boundary instead of
 * charging 1/100th of the intended deposit. The server hands this number
 * straight to Stripe, which also expects minor units — wire and server agree.
 *
 * `currency` carries `.default('usd')`, which MATERIALISES: a parsed body
 * CONTAINS `currency: 'usd'` even when the caller omitted the key. The default
 * lives here rather than in the feature schema only because the feature schema
 * IS this object plus `organizationId` — the server's behaviour is byte-for-byte
 * what it was. It is deliberately an unconstrained `z.string()` (no ISO-4217
 * length/enum check) because that is what the server accepted before this
 * contract existed; validating it is a behaviour change, not a refactor.
 *
 * `expirationHours` is bounded to 1..168 (one hour to seven days) — an
 * unbounded window would leave a checkout session claimable indefinitely.
 * `successUrl` / `cancelUrl` are `.url()`-validated; they are handed to Stripe
 * as redirect targets, so a blank string must never reach it. Both are
 * REQUIRED, so "blank" is simply not a valid submission — a form with an empty
 * default for either has a bug that this contract now surfaces at the boundary.
 */
export const createDepositRequestBase = z.object({
  appointmentId: z.string().min(1),
  amountCents: z.number().int().positive(),
  currency: z.string().default('usd'),
  expirationHours: z.number().int().min(1).max(168).optional(), // 1 hour to 7 days
  successUrl: externalRedirectUrl,
  cancelUrl: externalRedirectUrl,
});

/**
 * `POST /deposits` body — the VALIDATING half. Use this everywhere a body is
 * parsed (API DTO, any frontend payload builder). Unknown keys are rejected, so
 * `organizationId` in a body is an error, not a silently-ignored field.
 */
export const createDepositRequestSchema = createDepositRequestBase.strict();

export type CreateDepositRequest = z.infer<typeof createDepositRequestSchema>;

/**
 * `POST /deposits/:id/refund` body — the EXTENDABLE half.
 *
 * MONEY, and almost empty on purpose. The deposit being refunded is identified
 * by the `:id` ROUTE PARAM, and the org by the session; neither may be supplied
 * in the body, which is why `.strict()` matters more here than anywhere else in
 * this file. A client that tried to pass `depositId` in the body — refunding a
 * deposit other than the one in the URL — now gets a parse error rather than a
 * silently ignored key.
 *
 * `reason` is the Stripe refund-reason vocabulary and is a closed `z.enum`, not
 * a free string: Stripe rejects unknown reasons, and the set is Stripe's rather
 * than ours, so it is spelled out literally here instead of being pulled from
 * `@borradh-workspace/labels`. It is optional — Stripe treats an absent reason
 * as an unspecified refund.
 *
 * There is no `amountCents`: refunds here are always FULL refunds of the
 * recorded deposit. Adding a partial-refund amount is a server change, not a
 * contract one — do not add the field here first.
 */
export const refundDepositRequestBase = z.object({
  reason: z
    .enum(['requested_by_customer', 'duplicate', 'fraudulent'])
    .optional(),
});

/**
 * `POST /deposits/:id/refund` body — the VALIDATING half.
 */
export const refundDepositRequestSchema = refundDepositRequestBase.strict();

export type RefundDepositRequest = z.infer<typeof refundDepositRequestSchema>;
