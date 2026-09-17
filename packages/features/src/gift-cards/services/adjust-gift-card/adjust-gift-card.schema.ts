import { adjustGiftCardRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for adjusting a gift card's balance.
 *
 * DERIVED from the canonical wire contract (`adjustGiftCardRequestBase` in
 * `@borradh-workspace/contracts`) by extending the server-injected context onto
 * it — wire -> server, so the signed, non-zero `amountCents` rule (positive
 * tops up, negative reduces) has exactly one description.
 */
export const adjustGiftCardSchema = adjustGiftCardRequestBase.extend({
  organizationId: z.string().min(1),
  giftCardId: z.string().min(1),
  createdById: z.string().min(1).optional(),
});

export type AdjustGiftCardInput = z.input<typeof adjustGiftCardSchema>;
