import { listOffersResponseSchema } from '@borradh-workspace/contracts';
import type { OfferDiscountType, OfferState } from '@borradh-workspace/labels';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

interface OfferListEntry {
  id: string;
  name: string;
  /** Coupon code, when the offer has one. */
  code: string | null;
  /** Lifecycle state — replaces the `isActive` boolean this tool used to read. */
  state: OfferState;
  /** percentage | fixed_price | fixed_amount | buy_x_get_y. */
  discountType: OfferDiscountType;
  discountPercent: number | null;
  discountAmountCents: number | null;
  originalPriceCents: number | null;
  offerPriceCents: number | null;
  buyQuantity: number | null;
  getQuantity: number | null;
  validFrom: string | null;
  validUntil: string | null;
  redemptionLimit: number | null;
  redemptionCount: number;
  serviceIds: string[];
  /** Empty means "every org location" (empty-junction convention). */
  locationIds: string[];
}

interface ListOffersOutput {
  offers: OfferListEntry[];
  total: number;
}

/**
 * `context_listOffers` — list marketing offers.
 *
 * Ported from the legacy `listOffers` tool in `context-tools.ts`.
 *
 * FIELD-NAME BUG (same shape as `listServices`/`pricingDescription`): this tool
 * used to map `headline`, `type`, `bulletPoints`, `ctaText`, `urgencyText` and
 * `isActive` off each item. None of those is a column on `offer` (see
 * `packages/database/src/schema/offer.ts` — the real fields are `state`,
 * `discountType`, `code`, `discountAmountCents`, `redemptionLimit`,
 * `redemptionCount`, …), so six of the thirteen reported fields read
 * `undefined` on every call — including the discount shape and the
 * active flag, i.e. everything Claire needs to describe an offer. Its unit test
 * mocked the invented names, so the suite stayed green over dead fields.
 *
 * QUERY BUG: the tool sent `?isActive=<bool>`. `listOffersSchema` has no
 * `isActive` — it takes `state` — so the ValidationPipe dropped it and
 * `activeOnly` filtered nothing; expired and draft offers came back either way.
 * Now sends `state=active` when `activeOnly` is set.
 */
export const listOffersTool = defineTool<
  { activeOnly?: boolean },
  ListOffersOutput
>({
  feature: 'context',
  action: 'listOffers',
  description:
    'List marketing offers (discounts, bundles, etc.) for the organization. ' +
    'Returns offer details including lifecycle state, discount shape, ' +
    'validity dates, redemption caps, and the services + locations each offer ' +
    'is scoped to.',
  inputSchema: z.object({
    activeOnly: z
      .boolean()
      .optional()
      .describe('Only show offers in the "active" state (default: true)'),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Listing offers' },
  execute: async ({ activeOnly }, ctx) => {
    const onlyActive = activeOnly ?? true;
    const params = new URLSearchParams();
    if (onlyActive) params.set('state', 'active');
    params.set('limit', '50');

    const data = await ctx.apiFetch(`offers?${params.toString()}`, {
      schema: listOffersResponseSchema,
    });

    return {
      data: {
        offers: data.items.map((o) => ({
          id: o.id,
          name: o.name,
          code: o.code,
          state: o.state,
          discountType: o.discountType,
          discountPercent: o.discountPercent,
          discountAmountCents: o.discountAmountCents,
          originalPriceCents: o.originalPriceCents,
          offerPriceCents: o.offerPriceCents,
          buyQuantity: o.buyQuantity,
          getQuantity: o.getQuantity,
          validFrom: o.validFrom,
          validUntil: o.validUntil,
          redemptionLimit: o.redemptionLimit,
          redemptionCount: o.redemptionCount,
          serviceIds: o.serviceIds,
          locationIds: o.locationIds,
        })),
        total: data.total,
      },
    };
  },
});
