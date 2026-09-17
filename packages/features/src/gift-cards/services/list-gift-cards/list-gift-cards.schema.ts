import { z } from 'zod';

export const listGiftCardsSchema = z.object({
  organizationId: z.string().min(1),
  leadId: z.string().min(1).optional(),
  search: z.string().min(1).optional(),
  /**
   * Branch filter, from the validated `X-Location-Id` header.
   *
   * `gift_card` has NO `location_id` — Phase 1 did not add one — so the branch
   * is derived from PROVENANCE: the sale line that issued it
   * (`sale_item_id` -> `sale_item.sale_id` -> `sale.location_id`). Cards with
   * no issuing sale line (adjustments, imports, manual issues) match every
   * branch, because there is nothing that says otherwise and hiding them would
   * lose real balances from the only list that shows them.
   *
   * A card is redeemable at ANY branch regardless — that is a rule in the
   * redemption path, not a row, and this filter does not change it.
   */
  locationId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListGiftCardsInput = z.input<typeof listGiftCardsSchema>;
