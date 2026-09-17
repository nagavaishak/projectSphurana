import {
  addSalePaymentRefinement,
  addSalePaymentRequestBase,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { zCents } from '../../../shared/index.js';

/**
 * Schema for recording a tender against a sale — the endpoint that moves money.
 *
 * DERIVED from the canonical wire contract (`addSalePaymentRequestBase` in
 * `@borradh-workspace/contracts`), extended with the server-injected context
 * and refined with the SAME callback the wire schema applies
 * (`addSalePaymentRefinement`), so the gift-card-code and reader-type rules
 * have exactly one description.
 *
 * MONEY — the one field declared twice, deliberately.
 * `amountCents` is re-declared here as branded `zCents({ positive: true })`
 * because the payment service does `Cents` arithmetic on it. That is
 * `z.number().int().positive().brand<'Cents'>()` — numerically IDENTICAL to the
 * contract's `z.number().int().positive()`, with the brand erased at runtime
 * (input stays a plain `number`, so callers/DTOs are unaffected). The brand
 * cannot live in `contracts`, which must not depend on `features`. Both
 * declarations are integer MINOR UNITS; there is no decimal representation
 * anywhere on this path. If the numeric constraint changes in either place,
 * change it in both.
 */
export const addSalePaymentSchema = addSalePaymentRequestBase
  .extend({
    organizationId: z.string().min(1),
    saleId: z.string().min(1),
    // Branded `Cents` (see shared/core/branded.ts). Same constraint as the
    // contract's `amountCents`; see the note above before touching it.
    amountCents: zCents({ positive: true }),
    createdById: z.string().min(1).optional(),
  })
  .superRefine(addSalePaymentRefinement);

export type AddSalePaymentInput = z.input<typeof addSalePaymentSchema>;
