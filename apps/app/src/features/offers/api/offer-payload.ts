/**
 * The ONE place offer request bodies are built.
 *
 * `PUT /offers/:id` used to have four independent payload builders — the
 * offer-form-dialog (create + update) plus three Claire preview-card hooks
 * (save-draft, update-pending, publish) that each hand-rolled their own
 * date transforms and discount-type-conditional keys straight into
 * `apiClient.put`. That is textbook payload drift: two surfaces editing the
 * same offer could send different-but-both-valid bodies.
 *
 * Every writer now passes typed **intent** (form values or sparse draft
 * edits) and this module assembles the wire body. Output is validated by a
 * `.strict()` zod schema so an extra or missing key is a parse error, not a
 * silent strip.
 *
 * See docs/engineering/mutation-payload-pattern.md.
 */

import type {
  OfferDiscountType,
  OfferState,
} from '@borradh-workspace/api-client/types';
import {
  createOfferRequestSchema,
  updateOfferRequestSchema,
} from '@borradh-workspace/contracts';
import type { z } from 'zod';

// ============================================================================
// WIRE BODY SCHEMAS (.strict()) — RE-EXPORTED FROM THE CANONICAL CONTRACT
// ============================================================================

/**
 * These used to be a hand-declared `offerBodyShape` living here — a SECOND
 * description of the same wire body, free to drift from the one the server
 * enforces (and it had: it typed every numeric as a plain `z.number()`, so a
 * fractional `discountPercent` or a 12000% discount parsed clean here and 400'd
 * server-side). They are now the canonical contract itself, from
 * `packages/contracts/src/requests/catalog.ts`, which the backend feature
 * schemas `.extend()` with their server-injected fields. One description, two
 * consumers.
 *
 * Dates stay ISO STRINGS on the wire (`z.string().datetime()`); the feature
 * schema re-types those two keys to `z.coerce.date()` when it derives, so the
 * builder below still emits `.toISOString()` exactly as before.
 *
 * The contract is TIGHTER than what stood here, in ways that matter:
 *  - unknown keys were already rejected, but numerics are now `.int()` with the
 *    server's real bounds (`discountPercent` 1–100, cents ≥ 0, quantities ≥ 1);
 *  - `name` must be non-empty and ≤ 200 chars;
 *  - `code` is trimmed and empty-collapsed to `null` by the contract's own
 *    transform, so the builder does not need to normalise `''` — unlike the
 *    `.email()`/`.min(1)` fields on other contracts, `''` is legal here;
 *  - create enforces the discount-shape discriminant (a `percentage` offer with
 *    no `discountPercent` now throws in the builder instead of 400ing).
 */
export const createOfferBodySchema = createOfferRequestSchema;
export type CreateOfferBody = z.infer<typeof createOfferBodySchema>;

/**
 * Update may be full (form dialog) or a sparse subset (Claire draft edits), so
 * every field is optional on the contract already. `.strict()` still rejects
 * unknown keys, and the discount-shape refinement is a no-op unless the body
 * carries an explicit `discountType`.
 */
export const updateOfferBodySchema = updateOfferRequestSchema;
export type UpdateOfferBody = z.infer<typeof updateOfferBodySchema>;

// ============================================================================
// INTENT TYPES — what UI surfaces naturally have
// ============================================================================

/**
 * The offer-form-dialog's domain values: money entered in euros, validity
 * as `Date` objects. The builder converts to cents / ISO strings.
 */
export interface OfferFormIntent {
  name: string;
  description: string | null;
  code: string | null;
  state: OfferState;
  discountType: OfferDiscountType;
  discountPercent: number | null;
  discountAmountEuros: number | null;
  originalPriceEuros: number | null;
  offerPriceEuros: number | null;
  buyQuantity: number | null;
  getQuantity: number | null;
  redemptionLimit: number | null;
  validFrom: Date | null;
  validUntil: Date | null;
  serviceIds: string[];
  locationIds: string[];
}

/**
 * The Claire preview-card's sparse edits. Only keys the card actually
 * touched are present; `offerPriceCents` / `discountPercent` are already in
 * cents / percent. Which of the two discount values survives is decided by
 * the draft's `discountType` (see `buildUpdateOfferPayload`).
 */
export interface OfferDraftEditIntent {
  name?: string;
  validUntil?: string | null;
  discountPercent?: number | null;
  offerPriceCents?: number | null;
}

/** Discriminated intent for the single update builder. */
export type UpdateOfferIntent =
  | { source: 'form'; values: OfferFormIntent }
  | {
      source: 'draft';
      discountType: OfferDiscountType;
      edits: OfferDraftEditIntent;
    };

// ============================================================================
// BUILDERS
// ============================================================================

function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function eurosToCents(euros: number | null | undefined): number | null {
  return euros != null ? Math.round(euros * 100) : null;
}

/**
 * Full offer body from form intent — discount-type-conditional fields are
 * nulled for the non-selected shapes, exactly as the dialog did inline.
 * Create and a form-driven update send this identical shape.
 */
function buildFullOfferBody(input: OfferFormIntent): CreateOfferBody {
  const { discountType } = input;
  const code = input.code?.trim();
  return createOfferBodySchema.parse({
    name: input.name.trim(),
    // Blank collapses to `null` in the contract's own transform, same as
    // `code` — the builder does not need to normalise `''`.
    description: input.description,
    code: code ? code : null,
    state: input.state,
    discountType,
    discountPercent:
      discountType === 'percentage' ? input.discountPercent : null,
    discountAmountCents:
      discountType === 'fixed_amount'
        ? eurosToCents(input.discountAmountEuros)
        : null,
    originalPriceCents:
      discountType === 'fixed_price'
        ? eurosToCents(input.originalPriceEuros)
        : null,
    offerPriceCents:
      discountType === 'fixed_price'
        ? eurosToCents(input.offerPriceEuros)
        : null,
    buyQuantity: discountType === 'buy_x_get_y' ? input.buyQuantity : null,
    getQuantity: discountType === 'buy_x_get_y' ? input.getQuantity : null,
    limitPerClient: false,
    redemptionLimit: input.redemptionLimit ?? null,
    validFrom: isoOrNull(input.validFrom),
    validUntil: isoOrNull(input.validUntil),
    serviceIds: input.serviceIds,
    locationIds: input.locationIds,
  });
}

/**
 * Sparse update body from Claire draft edits. Emits only the keys the card
 * touched; the discount value is gated by the draft's `discountType` so a
 * percentage draft never sends `offerPriceCents` and vice-versa.
 */
function buildDraftEditBody(
  discountType: OfferDiscountType,
  edits: OfferDraftEditIntent
): UpdateOfferBody {
  const body: Partial<UpdateOfferBody> = {};
  if ('name' in edits) body.name = edits.name;
  if ('validUntil' in edits) body.validUntil = edits.validUntil;
  if (discountType === 'percentage' && 'discountPercent' in edits) {
    body.discountPercent = edits.discountPercent;
  }
  if (discountType === 'fixed_price' && 'offerPriceCents' in edits) {
    body.offerPriceCents = edits.offerPriceCents;
  }
  return updateOfferBodySchema.parse(body);
}

/** Build the `POST /offers` body. */
export function buildCreateOfferPayload(
  input: OfferFormIntent
): CreateOfferBody {
  return buildFullOfferBody(input);
}

/** Build the `PUT /offers/:id` body — the single builder for that route. */
export function buildUpdateOfferPayload(
  intent: UpdateOfferIntent
): UpdateOfferBody {
  if (intent.source === 'form') {
    // `state` is DROPPED on update, and that is the whole point of not simply
    // reusing the create body.
    //
    // No surface answers it: a promotion is created active, and the editor
    // renders no state control. What the form holds is whatever was loaded, so
    // sending it back is a read-modify-write of a field nobody edited — and it
    // loses in two real ways. A promotion paused or expired between load and
    // save is silently reactivated by the stale 'active'. And `offerToForm`
    // maps 'expired' onto 'paused' (the form has no 'expired' option), so
    // merely opening an expired promotion and pressing Save used to change its
    // state.
    //
    // Omitting it leaves the stored state alone, which is what "editing the
    // details" means. Ending or pausing a promotion is `expireOffer` and the
    // status controls on the list — deliberate acts, not a side effect of
    // saving a name change.
    const { state: _ignored, ...body } = buildFullOfferBody(intent.values);
    return updateOfferBodySchema.parse(body);
  }
  return buildDraftEditBody(intent.discountType, intent.edits);
}
