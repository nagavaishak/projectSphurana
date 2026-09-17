/**
 * catalog request CONTRACTS — the canonical, strict Zod schema for the BODY of
 * each catalog write endpoint: services (`/organization-services`), service
 * categories (`/service-categories`) and offers (`/offers`).
 *
 * A request contract is the wire-shaped twin of a response projection: it
 * describes exactly what the client is allowed to POST/PUT, written here in
 * pure Zod so it stays frontend-safe (no drizzle / database in the runtime
 * graph — see index.ts). Enums come from `@borradh-workspace/labels`, never
 * from `api-client`.
 *
 * DIRECTION OF DERIVATION — wire -> server
 * ---------------------------------------
 * This file is the SOURCE. The feature schemas DERIVE from it by `.extend()`ing
 * the server-injected context fields onto the base:
 *
 *     createServiceSchema   = createServiceRequestBase.extend({ organizationId })
 *     updateServiceSchema   = updateServiceRequestBase.extend({ id, organizationId })
 *     createCategorySchema  = createCategoryRequestBase.extend({ organizationId })
 *     updateCategorySchema  = updateCategoryRequestBase.extend({ id, organizationId })
 *     createOfferBaseSchema = createOfferRequestBase.extend({ organizationId, …dates })
 *     updateOfferBaseSchema = updateOfferRequestBase.extend({ id, organizationId, …dates })
 *
 * Because the server schema literally IS the wire schema plus fields, it can
 * never be laxer than the wire schema, and no drift is possible. Do NOT invert
 * this — a contract hand-copied from the feature schema is exactly the drift
 * this package exists to eliminate.
 *
 * BASE vs SCHEMA — why two exports
 * --------------------------------
 * `.refine()` / `.superRefine()` return a `ZodEffects`, which has NO
 * `.extend()`. So every contract exports a matched pair:
 *
 *  - `<name>RequestBase`   — a plain `z.object({…})`. EXTENDABLE. This is what
 *    the backend feature schema extends with its context fields. It is NOT
 *    strict, because `.strict()` would reject the very fields being added.
 *  - `<name>RequestSchema` — `<name>RequestBase.strict()` (plus any refinement).
 *    This is what VALIDATES a wire body: unknown keys are REJECTED, so a client
 *    sending a stale, renamed or typo'd key fails loudly instead of having it
 *    silently stripped by a permissive `z.object`.
 *
 * DATES — the one field family that cannot be shared verbatim
 * -----------------------------------------------------------
 * A JSON body carries an ISO STRING; the offer service wants a `Date`. So the
 * wire contract declares `z.string().datetime()` and the feature schema
 * OVERRIDES exactly those keys back to `z.coerce.date()` in its `.extend()`.
 * Optionality and nullability still come from here, so a date key cannot
 * silently become required on one side only — only its REPRESENTATION differs.
 * (Same deliberate exception as `./appointments.ts`.)
 *
 * SERVICE PRICING IS A LOCKED MODEL — do not "improve" it here
 * -----------------------------------------------------------
 * `priceType` (fixed | from | free | poa) + `priceCents` (integer cents) are the
 * structured price; `priceText` is a legacy freeform display string. Currency is
 * derived from the organization's country, never from the browser locale and
 * never carried on the wire. `priceType` deliberately has NO `.default()`: when
 * omitted the service INFERS it from `priceCents` (bare `priceCents` → `fixed`,
 * none → `poa`), and adding a default here would change that SERVER behaviour,
 * because this object IS the server schema's base. See
 * docs/plans/service-pricing-model.md.
 *
 * Context fields the SERVER injects are absent from every body contract:
 *  - `organizationId` — from the active-org session, never sent by the client.
 *  - `id` on update — a ROUTE PARAM (`PUT /…/:id`), never a body key.
 *  - `actorId` on offer delete — the current user, from the session.
 *
 * NO DELETE CONTRACTS. `DELETE /organization-services/:id`,
 * `DELETE /service-categories/:id` and `DELETE /offers/:id` take NO body at
 * all: every field of `deleteServiceSchema` / `deleteCategorySchema` /
 * `deleteOfferSchema` is server-injected (`id` route param, `organizationId`
 * session, `actorId` session user). There is no wire shape to describe, so
 * those feature schemas stay hand-written and are intentionally not derived.
 */
import {
  depositBasisValues,
  offerDiscountTypeValues,
  offerStateValues,
  serviceCategoryValues,
  servicePaymentPolicyValues,
  servicePriceTypeValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';

// ============================================================================
// SERVICES — POST /organization-services, PUT /organization-services/:id
// ============================================================================

/**
 * `POST /organization-services` body — the EXTENDABLE half.
 *
 * Every field carries the exact validation the server enforces, including the
 * `.default(…)`s: because the feature schema is this object plus
 * `organizationId`, moving a default here does not change server behaviour, it
 * just makes the same default visible to the client. Note that `.default()`
 * means a PARSED body CONTAINS these keys even when the caller omitted them —
 * `createServiceRequestSchema.parse({ name: 'Facial' })` emits
 * `category: 'treatment'`, `sortOrder: 0`, `isCustom: true`, `isActive: true`
 * and `requiresDeposit: false`.
 *
 * The body is consumed by `createServiceWithDeposit`, whose schema is
 * `createServiceSchema` VERBATIM (the deposit branch is driven by the persisted
 * row, not by extra fields) — so that alias inherits this derivation for free.
 */
export const createServiceRequestBase = z.object({
  name: z.string().min(1, 'Service name is required').max(100),
  description: z.string().max(500).optional(),
  category: z.enum(serviceCategoryValues).optional().default('treatment'),
  // When provided, attaches the new service to a user-defined category
  // row. The `category` enum above stays populated for legacy code paths
  // until Phase 5 of the catalog cutover removes it.
  categoryId: z.string().min(1).optional().nullable(),

  sortOrder: z.number().int().min(0).optional().default(0),
  isCustom: z.boolean().optional().default(true),
  isActive: z.boolean().optional().default(true),

  // Deposit settings (per-service)
  requiresDeposit: z.boolean().optional().default(false),
  depositAmountCents: z.number().int().min(100).optional().nullable(), // min €1
  /** Null = inherit the org default. `in_clinic` is a real opt-OUT. */
  paymentPolicy: z.enum(servicePaymentPolicyValues).optional().nullable(),
  depositBasis: z.enum(depositBasisValues).optional().nullable(),
  /** Whole percent of this service's price. Rounded up to the next 50c. */
  depositPercent: z
    .number()
    .int()
    .min(1, 'Must be at least 1%')
    .max(100, 'Cannot exceed 100%')
    .optional()
    .nullable(),

  // Freeform price string. Examples: "€85 per session", "From £50",
  // "POA", "Free" (for a consultation service).
  priceText: z.string().max(200).optional().nullable(),

  // Structured price shape (fixed | from | free | poa). The single display
  // deriver `formatServicePrice` reads this + priceCents. Optional (no default):
  // when omitted the service INFERS it from priceCents so existing callers that
  // send only a number keep working (a bare priceCents → `fixed`, none → `poa`).
  // For `free`/`poa` the service normalises priceCents to null (see the service);
  // `fixed`/`from` carry the anchor. See docs/plans/service-pricing-model.md.
  priceType: z.enum(servicePriceTypeValues).optional(),

  // Structured list price in cents. Drives the multi-service cart total; a null
  // price is a "POA"/consultation line. NEVER parsed from `priceText` — the two
  // coexist (priceText is display, priceCents is arithmetic).
  priceCents: z.number().int().min(0).optional().nullable(),

  // Null means use the connected Stripe account's preset tax code.
  taxCode: z.string().min(1).optional().nullable(),

  // Duration of the bookable appointment in minutes.
  appointmentDuration: z.number().int().min(5).max(480).optional().nullable(),

  // Minutes the ROOM (and any other required resource) stays held after this
  // service ends, for cleanup. Does NOT extend the appointment or the
  // practitioner's busy time — only the resource allocation. null/0 = none,
  // which is the pre-resource-scheduling behaviour every existing service has.
  turnaroundMinutes: z
    .number()
    .int()
    .min(0)
    .max(240)
    .multipleOf(5)
    .optional()
    .nullable(),

  // Content generation fields
  painPoints: z.array(z.string()).optional().nullable(),
  expectedResults: z.array(z.string()).optional().nullable(),
  processDescription: z.string().max(2000).optional().nullable(),
  targetArea: z.string().max(500).optional().nullable(),
});

/**
 * `POST /organization-services` body — the VALIDATING half. Unknown keys are
 * rejected, so `organizationId` in a body is an error, not a silently-ignored
 * field.
 */
export const createServiceRequestSchema = createServiceRequestBase.strict();

export type CreateServiceRequest = z.infer<typeof createServiceRequestSchema>;

/**
 * `PUT /organization-services/:id` body — the EXTENDABLE half.
 *
 * Every field is optional because the endpoint applies PATCH semantics: a key
 * ABSENT from the body is left untouched, whereas an explicit `null` on a
 * nullable column CLEARS it. That distinction is why the nullable keys are
 * `.optional().nullable()` and not merely `.optional()`.
 *
 * `isCustom` is deliberately NOT here — it is set once at creation and the
 * update service does not accept it. `id` is the route param.
 *
 * `updateServiceWithDepositSchema` is `updateServiceSchema` VERBATIM, so it
 * inherits this derivation for free.
 */
export const updateServiceRequestBase = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  category: z.enum(serviceCategoryValues).optional(),
  categoryId: z.string().min(1).optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),

  // Deposit settings (per-service)
  requiresDeposit: z.boolean().optional(),
  depositAmountCents: z.number().int().min(100).optional().nullable(),
  paymentPolicy: z.enum(servicePaymentPolicyValues).optional().nullable(),
  depositBasis: z.enum(depositBasisValues).optional().nullable(),
  depositPercent: z
    .number()
    .int()
    .min(1, 'Must be at least 1%')
    .max(100, 'Cannot exceed 100%')
    .optional()
    .nullable(),

  // Freeform price string
  priceText: z.string().max(200).optional().nullable(),

  // Structured price shape (fixed | from | free | poa). Switching to free/poa
  // clears priceCents (see the service). See `createServiceRequestBase`.
  priceType: z.enum(servicePriceTypeValues).optional(),

  // Structured list price in cents (see `createServiceRequestBase`). Never
  // parsed from priceText.
  priceCents: z.number().int().min(0).optional().nullable(),

  // Null means use the connected Stripe account's preset tax code.
  taxCode: z.string().min(1).optional().nullable(),

  // Appointment duration in minutes
  appointmentDuration: z.number().int().min(5).max(480).optional().nullable(),

  // Minutes the ROOM (and any other required resource) stays held after this
  // service ends, for cleanup. Does NOT extend the appointment or the
  // practitioner's busy time — only the resource allocation. null/0 = none,
  // which is the pre-resource-scheduling behaviour every existing service has.
  turnaroundMinutes: z
    .number()
    .int()
    .min(0)
    .max(240)
    .multipleOf(5)
    .optional()
    .nullable(),

  // Content generation fields
  painPoints: z.array(z.string()).optional().nullable(),
  expectedResults: z.array(z.string()).optional().nullable(),
  processDescription: z.string().max(2000).optional().nullable(),
  targetArea: z.string().max(500).optional().nullable(),
});

/** `PUT /organization-services/:id` body — the VALIDATING half. */
export const updateServiceRequestSchema = updateServiceRequestBase.strict();

export type UpdateServiceRequest = z.infer<typeof updateServiceRequestSchema>;

// ============================================================================
// SERVICE CATEGORIES — POST /service-categories, PUT /service-categories/:id
// ============================================================================

/**
 * `POST /service-categories` body — the EXTENDABLE half.
 *
 * `sortOrder` and `isActive` carry `.default(…)`, so a parsed body contains
 * `sortOrder: 0` / `isActive: true` even when the caller omitted them.
 */
export const createCategoryRequestBase = z.object({
  name: z.string().min(1, 'Category name is required').max(100),
  description: z.string().max(500).optional().nullable(),
  sortOrder: z.number().int().min(0).optional().default(0),
  isActive: z.boolean().optional().default(true),
});

/** `POST /service-categories` body — the VALIDATING half. */
export const createCategoryRequestSchema = createCategoryRequestBase.strict();

export type CreateCategoryRequest = z.infer<typeof createCategoryRequestSchema>;

/**
 * `PUT /service-categories/:id` body — the EXTENDABLE half. PATCH semantics:
 * every key optional, `description: null` CLEARS the description.
 */
export const updateCategoryRequestBase = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

/** `PUT /service-categories/:id` body — the VALIDATING half. */
export const updateCategoryRequestSchema = updateCategoryRequestBase.strict();

export type UpdateCategoryRequest = z.infer<typeof updateCategoryRequestSchema>;

// ============================================================================
// OFFERS — POST /offers, PUT /offers/:id
// ============================================================================

/**
 * Discount-shape rules shared by create and update, wire and server.
 *
 * Only the fields for the chosen `discountType` are required; the others stay
 * nullable and are stored verbatim. This has to live on the strict half rather
 * than in the base, because a `.superRefine()` produces a `ZodEffects` that the
 * feature schema could not then `.extend()` — the price of the Base/Schema
 * split. Rather than RESTATE it (as `./appointments.ts` must for its
 * `.refine()`s, which close over nothing shareable), it is EXPORTED: the
 * feature schemas `createOfferSchema` / `updateOfferSchema` apply this exact
 * function to their derived bases, so the wire and the service can never
 * disagree about which fields a given `discountType` requires.
 */
export const offerDiscountShapeIssues = (
  data: {
    discountType?: (typeof offerDiscountTypeValues)[number];
    discountPercent?: number | null;
    discountAmountCents?: number | null;
    originalPriceCents?: number | null;
    offerPriceCents?: number | null;
    buyQuantity?: number | null;
    getQuantity?: number | null;
  },
  ctx: z.RefinementCtx,
  // On update the refinement only fires when `discountType` is explicitly set,
  // since a partial update may carry just `state` or `validUntil`. On create it
  // is always present.
  options: { checkOriginalPrice: boolean }
) => {
  if (data.discountType === undefined) return;

  if (data.discountType === 'percentage' && data.discountPercent == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['discountPercent'],
      message: 'discountPercent is required for percentage discounts',
    });
  }
  if (
    data.discountType === 'fixed_amount' &&
    data.discountAmountCents == null
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['discountAmountCents'],
      message: 'discountAmountCents is required for fixed_amount discounts',
    });
  }
  if (data.discountType === 'fixed_price') {
    if (data.offerPriceCents == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['offerPriceCents'],
        message: 'offerPriceCents is required for fixed_price discounts',
      });
    }
    // Only CREATE checks this. An update may raise `offerPriceCents` without
    // resending `originalPriceCents`, and the stored original is not visible to
    // a body-level refinement — mirroring `update-offer.schema.ts`, which also
    // omits the comparison.
    if (
      options.checkOriginalPrice &&
      data.originalPriceCents != null &&
      data.offerPriceCents != null &&
      data.offerPriceCents >= data.originalPriceCents
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['offerPriceCents'],
        message: 'offerPriceCents must be lower than originalPriceCents',
      });
    }
  }
  if (data.discountType === 'buy_x_get_y') {
    if (data.buyQuantity == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['buyQuantity'],
        message: 'buyQuantity is required for buy_x_get_y discounts',
      });
    }
    if (data.getQuantity == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['getQuantity'],
        message: 'getQuantity is required for buy_x_get_y discounts',
      });
    }
  }
};

/**
 * `POST /offers` body — the EXTENDABLE half.
 *
 * `code` is trimmed and empty-string-collapsed to `null` by a `.transform()`,
 * so a blank promo-code input needs NO normaliser in the payload builder: `''`
 * is legal here and lands as `null`. That is deliberately different from the
 * `.email()` / `.min(1)` fields elsewhere, which reject `''` outright.
 *
 * `validFrom` / `validUntil` are ISO STRINGS on the wire (`z.string()
 * .datetime()`); the feature schema overrides both keys to `z.coerce.date()`
 * when it derives. See the DATES note in the file header.
 *
 * `.default(…)` on `state`, `limitPerClient`, `serviceIds` and `locationIds`
 * materialises into the parsed body: `createOfferRequestSchema.parse({ name,
 * discountType: 'percentage', discountPercent: 10 })` emits `state: 'active'`,
 * `limitPerClient: false`, `serviceIds: []` and `locationIds: []`.
 */
export const createOfferRequestBase = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  // Operator-facing notes. Blank is CLEARED, not stored, so an untouched
  // textarea does not persist an empty string that later reads as content.
  description: z
    .string()
    .max(2000)
    .optional()
    .nullable()
    .transform((v) => {
      if (v == null) return null;
      const trimmed = v.trim();
      return trimmed.length === 0 ? null : trimmed;
    }),
  code: z
    .string()
    .max(40)
    .optional()
    .nullable()
    .transform((v) => {
      if (v == null) return null;
      const trimmed = v.trim();
      return trimmed.length === 0 ? null : trimmed;
    }),

  state: z.enum(offerStateValues).optional().default('active'),

  discountType: z.enum(offerDiscountTypeValues),
  discountPercent: z.number().int().min(1).max(100).optional().nullable(),
  discountAmountCents: z.number().int().min(0).optional().nullable(),
  originalPriceCents: z.number().int().min(0).optional().nullable(),
  offerPriceCents: z.number().int().min(0).optional().nullable(),
  buyQuantity: z.number().int().min(1).optional().nullable(),
  getQuantity: z.number().int().min(1).optional().nullable(),

  limitPerClient: z.boolean().optional().default(false),
  redemptionLimit: z.number().int().min(1).optional().nullable(),

  validFrom: z.string().datetime().optional().nullable(),
  validUntil: z.string().datetime().optional().nullable(),

  // Linked entities (replaces all existing links if provided)
  serviceIds: z.array(z.string().min(1)).optional().default([]),
  // Empty = applies to all org locations
  locationIds: z.array(z.string().min(1)).optional().default([]),
});

/**
 * `POST /offers` body — the VALIDATING half, with the discount-shape
 * refinement applied.
 */
export const createOfferRequestSchema = createOfferRequestBase
  .strict()
  .superRefine((data, ctx) =>
    offerDiscountShapeIssues(data, ctx, { checkOriginalPrice: true })
  );

export type CreateOfferRequest = z.infer<typeof createOfferRequestSchema>;

/**
 * `PUT /offers/:id` body — the EXTENDABLE half.
 *
 * Every key is optional: the endpoint has TWO writers — the offer-form dialog
 * (which sends the full shape) and Claire's preview card (which sends a sparse
 * subset of name / validUntil / the one numeric field matching the draft's
 * discount type). `code`'s transform distinguishes ABSENT (`undefined`, leave
 * alone) from CLEARED (`null` or blank, wipe it).
 */
export const updateOfferRequestBase = z.object({
  name: z.string().min(1).max(200).optional(),
  // Same absent-vs-cleared distinction `code` makes: `undefined` leaves the
  // stored note alone, `null` or blank wipes it.
  description: z
    .string()
    .max(2000)
    .nullable()
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      if (v === null) return null;
      const trimmed = v.trim();
      return trimmed.length === 0 ? null : trimmed;
    }),
  code: z
    .string()
    .max(40)
    .nullable()
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      if (v === null) return null;
      const trimmed = v.trim();
      return trimmed.length === 0 ? null : trimmed;
    }),

  state: z.enum(offerStateValues).optional(),

  discountType: z.enum(offerDiscountTypeValues).optional(),
  discountPercent: z.number().int().min(1).max(100).optional().nullable(),
  discountAmountCents: z.number().int().min(0).optional().nullable(),
  originalPriceCents: z.number().int().min(0).optional().nullable(),
  offerPriceCents: z.number().int().min(0).optional().nullable(),
  buyQuantity: z.number().int().min(1).optional().nullable(),
  getQuantity: z.number().int().min(1).optional().nullable(),

  limitPerClient: z.boolean().optional(),
  redemptionLimit: z.number().int().min(1).optional().nullable(),

  validFrom: z.string().datetime().optional().nullable(),
  validUntil: z.string().datetime().optional().nullable(),

  // If provided, replaces all existing links
  serviceIds: z.array(z.string().min(1)).optional(),
  locationIds: z.array(z.string().min(1)).optional(),
});

/**
 * `PUT /offers/:id` body — the VALIDATING half. The discount-shape refinement
 * is a no-op unless `discountType` is explicitly present.
 */
export const updateOfferRequestSchema = updateOfferRequestBase
  .strict()
  .superRefine((data, ctx) =>
    offerDiscountShapeIssues(data, ctx, { checkOriginalPrice: false })
  );

export type UpdateOfferRequest = z.infer<typeof updateOfferRequestSchema>;

// ---------------------------------------------------------------------------
// PUT /organization-services/:id/locations
// ---------------------------------------------------------------------------

/**
 * One branch assignment for a catalogue entry.
 *
 * The two override columns are what make this a join ROW rather than a bare
 * id list: they are the only place "Botox is €250 in Dublin, €220 in Cork" can
 * live short of duplicating the service, which the schema rules out (18 tables
 * reference `organization_service.id`).
 *
 * `null` on either override means INHERIT the catalogue entry's own value —
 * not "free" and not "no duration". A branch that only charges differently
 * sets `priceCentsOverride` and leaves the duration null, and the read path
 * (`applyServiceLocationOverride`) is built around exactly that.
 */
export const catalogLocationAssignmentRequestBase = z.object({
  locationId: z.string().min(1),
  priceCentsOverride: z.number().int().min(0).nullish(),
  durationMinutesOverride: z.number().int().min(1).nullish(),
  /**
   * Per-branch prices for this service's VARIANTS, at this branch.
   *
   * Carried on the same assignment rather than a separate endpoint because a
   * branch's pricing is one decision: for a variant-priced service,
   * `priceCentsOverride` above only moves the "from", and moving it without
   * the options it summarises leaves the headline and the list contradicting
   * each other. Sending them together makes the incoherent state hard to reach.
   *
   * Omitted = leave this branch's variant prices untouched. An empty array
   * CLEARS them (back to the variants' own prices) — the same
   * replace-semantics as the surrounding endpoint.
   */
  variantOverrides: z
    .array(
      z
        .object({
          variantId: z.string().min(1),
          priceCentsOverride: z.number().int().min(0),
        })
        .strict()
    )
    .optional(),
});

export const catalogLocationAssignmentRequestSchema =
  catalogLocationAssignmentRequestBase.strict();

export type CatalogLocationAssignmentRequest = z.infer<
  typeof catalogLocationAssignmentRequestSchema
>;

/**
 * `PUT /organization-services/:id/locations` body — the EXTENDABLE half.
 *
 * `.min(0)` is deliberate and load-bearing, for a REASON THAT DIFFERS from the
 * practitioner equivalent. There, an empty array means "works nowhere". Here,
 * ZERO ROWS MEANS OFFERED EVERYWHERE — the convention the whole read path is
 * built on (`atLocationOrUnassigned`), and the only one under which these
 * tables could land empty without blanking every catalogue in production.
 *
 * So sending `[]` is how an owner says "back to available at every branch",
 * and it must stay expressible. It is NOT how they say "available nowhere";
 * that state does not exist, and `isActive: false` is what expresses it.
 */
export const assignCatalogLocationsRequestBase = z.object({
  // Nested STRICT half: nothing extends an individual assignment entry, so an
  // unknown key inside one is drift and must be rejected, not stripped.
  locations: z.array(catalogLocationAssignmentRequestSchema).min(0),
});

/** `PUT /…/:id/locations` body — the VALIDATING half. */
export const assignCatalogLocationsRequestSchema =
  assignCatalogLocationsRequestBase.strict();

export type AssignCatalogLocationsRequest = z.infer<
  typeof assignCatalogLocationsRequestSchema
>;

/**
 * `POST /organization-services/:id/locations` body — "offer this at these
 * branches TOO".
 *
 * ADDITIVE, and a separate endpoint from the PUT above rather than a flag on
 * it, because the two have genuinely different failure modes. PUT REPLACES the
 * whole set, so a caller that wants to add one branch must send back every
 * existing entry — including the `priceCentsOverride` values it can only get
 * from a read that does not exist. Getting that wrong does not error: it
 * silently blanks a branch's price back to the catalogue default.
 *
 * So import posts the branches it wants ADDED and the server merges. Idempotent
 * by construction (the join table is unique on (service, location)), and the
 * "zero rows means everywhere" convention is honoured server-side — adding a
 * branch to a service offered everywhere is a NO-OP, not a narrowing to that
 * one branch.
 */
export const addCatalogLocationsRequestBase = z.object({
  locationIds: z.array(z.string().min(1)).min(1),
});

export const addCatalogLocationsRequestSchema =
  addCatalogLocationsRequestBase.strict();

export type AddCatalogLocationsRequest = z.infer<
  typeof addCatalogLocationsRequestSchema
>;

// ---------------------------------------------------------------------------
// PUT /membership-plans/:id/locations
// PUT /products/:id/locations
// ---------------------------------------------------------------------------

/**
 * `PUT /membership-plans/:id/locations` and `PUT /products/:id/locations` body.
 *
 * A BARE ID LIST, not the assignment objects services use, because
 * `membership_plan_location` and `product_location` have no override columns —
 * they answer "sold here?" and nothing else. Giving them a richer body than the
 * table can store would invite a caller to send a price the server silently
 * drops.
 *
 * `.min(0)` carries the same meaning as on the service endpoint: an empty array
 * restores "available at every branch". See
 * `assignCatalogLocationsRequestBase`.
 */
export const assignEntityLocationsRequestBase = z.object({
  locationIds: z.array(z.string().min(1)).min(0),
});

export const assignEntityLocationsRequestSchema =
  assignEntityLocationsRequestBase.strict();

export type AssignEntityLocationsRequest = z.infer<
  typeof assignEntityLocationsRequestSchema
>;
