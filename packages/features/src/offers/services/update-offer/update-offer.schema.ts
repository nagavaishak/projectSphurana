import {
  offerDiscountShapeIssues,
  updateOfferRequestBase,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { offerValidityIssues } from '../offer-validity-issues.js';

/**
 * Base object schema for updating an offer (without refinements).
 *
 * DERIVED from the canonical wire contract: `updateOfferRequestBase` in
 * `packages/contracts/src/requests/catalog.ts` is the SOURCE, and this is that
 * object plus
 *  - `id` — the `PUT /offers/:id` route param,
 *  - `organizationId` — server-injected from the active-org session, and
 *  - `validFrom` / `validUntil` RE-TYPED to `z.coerce.date()` (see
 *    `create-offer.schema.ts` for why the date family is the one exception).
 *
 * Add or change any other client-supplied field IN THE CONTRACT, not here.
 */
export const updateOfferBaseSchema = updateOfferRequestBase.extend({
  id: z.string().min(1, 'Offer ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  validFrom: z.coerce.date().optional().nullable(),
  validUntil: z.coerce.date().optional().nullable(),
});

/**
 * Schema for updating an offer. Discount-shape refinement only fires when
 * `discountType` is explicitly set, since a partial update may carry just
 * `state` or `validUntil`.
 *
 * `checkOriginalPrice: false` — an update may raise `offerPriceCents` without
 * resending `originalPriceCents`, and the stored original is not visible to a
 * body-level refinement. Shared with `updateOfferRequestSchema` so the wire and
 * the service enforce the same rule.
 */
export const updateOfferSchema = updateOfferBaseSchema
  .superRefine((data, ctx) =>
    offerDiscountShapeIssues(data, ctx, { checkOriginalPrice: false })
  )
  // Time-correctness backstop (Phase 3): an update may not start an offer
  // implausibly far out. The past-`validUntil` half is deliberately NOT
  // applied here — the offer edit dialog round-trips the stored `validUntil`
  // in a full-body PUT, so a blanket rule would make an already-expired offer
  // uneditable. `updateOfferImpl` enforces it against the stored row instead,
  // so only a genuine MOVE into the past is rejected.
  .superRefine((data, ctx) =>
    offerValidityIssues(data, ctx, { checkPastEnd: false })
  );

/** `z.input`, not `z.infer` — see `create-offer.schema.ts` for why. */
export type UpdateOfferInput = z.input<typeof updateOfferSchema>;
