import {
  createOfferRequestBase,
  offerDiscountShapeIssues,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { offerValidityIssues } from '../offer-validity-issues.js';

/**
 * Base object schema for creating a new offer (without refinements).
 *
 * DERIVED from the canonical wire contract: `createOfferRequestBase` in
 * `packages/contracts/src/requests/catalog.ts` is the SOURCE, and this is that
 * object plus
 *  - `organizationId` — server-injected from the active-org session, and
 *  - `validFrom` / `validUntil` RE-TYPED to `z.coerce.date()`.
 *
 * The date override is the one deliberate exception to "server schema = wire
 * schema + fields": a JSON body carries an ISO STRING (which the contract
 * validates with `z.string().datetime()`), while this service wants a `Date`.
 * Optionality and nullability still come from the contract, so a date key
 * cannot become required on one side only — only its REPRESENTATION differs,
 * and `z.coerce.date()` accepts precisely the strings the contract admits.
 *
 * Add or change any other client-supplied field IN THE CONTRACT, not here.
 */
export const createOfferBaseSchema = createOfferRequestBase.extend({
  organizationId: z.string().min(1, 'Organization ID is required'),
  validFrom: z.coerce.date().optional().nullable(),
  validUntil: z.coerce.date().optional().nullable(),
});

/**
 * Full schema with discount-type-conditional refinements (used in services).
 *
 * The refinement body is the contract's `offerDiscountShapeIssues`, shared with
 * `createOfferRequestSchema` so the two cannot disagree about which fields a
 * given `discountType` requires. `checkOriginalPrice: true` is the create-side
 * rule that `offerPriceCents` must undercut `originalPriceCents`.
 */
export const createOfferSchema = createOfferBaseSchema
  .superRefine((data, ctx) =>
    offerDiscountShapeIssues(data, ctx, { checkOriginalPrice: true })
  )
  // Time-correctness backstop (Phase 3): no pre-expired offers, no
  // implausibly far-future starts. Error messages quote today's date.
  .superRefine((data, ctx) =>
    offerValidityIssues(data, ctx, { checkPastEnd: true })
  );

/**
 * `z.input`, not `z.infer` — the same choice `create-appointment.schema.ts`
 * makes, and for the same reason. `validFrom` / `validUntil` are `z.coerce
 * .date()`, so the OUTPUT type is `Date` while a caller (the NestJS controller
 * spreading a DTO validated against the wire contract) legitimately supplies an
 * ISO STRING. `z.input` is the shape you may PASS IN; the service parses it and
 * works with the `Date` output internally.
 */
export type CreateOfferInput = z.input<typeof createOfferSchema>;
