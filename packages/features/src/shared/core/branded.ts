import { z } from 'zod';

/**
 * Branded primitives for money and entity IDs.
 *
 * ## Why
 * Two production bugs motivated this module:
 *   1. A money mixup where a float/string amount was added to an integer-cents
 *      amount, silently corrupting a total.
 *   2. A `practitioner.id` written into a `user.id` field — both are `string`,
 *      so the compiler never noticed the swap.
 *
 * Branded types make these mistakes *compile-time* errors:
 *   - `Cents` is a nominal `number`; raw `+`/`*` on money is discouraged in
 *     favour of the helpers, and a plain `number` will not satisfy a `Cents`
 *     parameter without going through {@link cents}.
 *   - `Id<Brand>` is a nominal `string`; a `PractitionerId` is NOT assignable to
 *     a `UserId`, so crossing the two won't type-check.
 *
 * A branded value is still structurally the underlying primitive at runtime
 * (a `Cents` IS a `number`, an `Id` IS a `string`), so the wire shape is
 * identical — a branded number serializes as a number.
 *
 * ## Rollout (incremental — this is deliberately NOT a full sweep)
 * These primitives are being applied one flow at a time. The current exemplars:
 *   - Money:  `add-sale-payment` (`amountCents` + remaining-balance math).
 *   - IDs:    appointment `assignedToId` (UserId) vs `practitionerId`
 *             (PractitionerId), so the two can no longer be crossed.
 *
 * FOLLOW-UP: extend `Cents` to every money column (totals, tips, deposits,
 * gift-card balances, prices) and `Id<Brand>` to every FK field. Until then,
 * unbranded call sites cast at the boundary (`x as Cents` / `x as UserId`) with
 * a `TODO(branded)` marker rather than exploding scope.
 */

// ---------------------------------------------------------------------------
// Money: Cents
// ---------------------------------------------------------------------------

/** A non-negative integer amount of minor currency units (cents). */
export type Cents = number & { readonly __brand: 'Cents' };

/**
 * Assert a raw number is a valid `Cents` value (integer, ≥ 0) and brand it.
 * Throws on floats or negatives — money must never be fractional cents, and a
 * negative amount at a boundary is a bug (ledger reversals negate a `Cents`
 * *after* branding, producing a plain `number`).
 */
export const cents = (n: number): Cents => {
  if (!Number.isInteger(n)) {
    throw new TypeError(`cents(): expected an integer, got ${n}`);
  }
  if (n < 0) {
    throw new TypeError(`cents(): expected a non-negative amount, got ${n}`);
  }
  return n as Cents;
};

/** Add two money amounts. */
export const addCents = (a: Cents, b: Cents): Cents => cents(a + b);

/**
 * Subtract `b` from `a`. Throws if the result would be negative — a negative
 * remaining balance is always a bug in the money flows this guards.
 */
export const subCents = (a: Cents, b: Cents): Cents => cents(a - b);

/** Multiply a money amount by a whole quantity (e.g. unit price × qty). */
export const multiplyCents = (c: Cents, qty: number): Cents => {
  if (!Number.isInteger(qty)) {
    throw new TypeError(`multiplyCents(): expected an integer qty, got ${qty}`);
  }
  return cents(c * qty);
};

/**
 * Zod helper producing a branded `Cents` schema. The parsed *output* is `Cents`
 * while the *input* stays `number`, so callers/DTOs keep passing plain numbers.
 *
 * @param opts.positive - require a strictly positive amount (default: allow 0).
 */
export const zCents = (opts?: { positive?: boolean }) =>
  (opts?.positive
    ? z.number().int().positive()
    : z.number().int().nonnegative()
  ).brand<'Cents'>();

// ---------------------------------------------------------------------------
// Entity IDs
// ---------------------------------------------------------------------------

/**
 * A nominal `string` id. Two ids with different `Brand`s are NOT mutually
 * assignable, so a `PractitionerId` cannot be passed where a `UserId` is
 * expected (and vice-versa).
 */
export type Id<Brand extends string> = string & { readonly __idBrand: Brand };

export type OrganizationId = Id<'Organization'>;
export type LeadId = Id<'Lead'>;
export type UserId = Id<'User'>;
export type AppointmentId = Id<'Appointment'>;
export type PractitionerId = Id<'Practitioner'>;
export type ServiceId = Id<'Service'>;

/**
 * Zod helper producing a branded `Id<Brand>` schema. Parsed *output* is
 * `Id<Brand>`; *input* stays `string`, so callers/DTOs keep passing plain
 * strings and no cascade of type errors follows from branding a boundary.
 *
 * @example
 *   assignedToId: zId<'User'>(),          // -> UserId
 *   practitionerId: zId<'Practitioner'>() // -> PractitionerId
 */
export const zId = <Brand extends string>(minLength = 1) =>
  z
    .string()
    .min(minLength)
    .transform((v): Id<Brand> => v as Id<Brand>);
