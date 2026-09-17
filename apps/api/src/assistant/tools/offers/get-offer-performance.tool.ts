import { offerWithServicesSchema } from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

interface OfferPerformanceOutput {
  offerId: string;
  name: string;
  code: string | null;
  state: string;
  discountType: string;
  validFrom: string | null;
  validUntil: string | null;
  pricing: {
    originalPriceCents: number | null;
    offerPriceCents: number | null;
    discountPercent: number | null;
    buyQuantity: number | null;
    getQuantity: number | null;
  };
  linkedServiceCount: number;
  serviceIds: string[];
  linkedLocationCount: number;
  locationIds: string[];
  /**
   * Marks that real performance metrics (views, conversions, revenue) aren't
   * yet ingested for offers. Frontend renderers / the model can surface this
   * to the operator instead of fabricating numbers. See window-c08 handoff
   * flag #2.
   */
  metricsAvailability: {
    viewsAvailable: false;
    conversionsAvailable: false;
    revenueAvailable: false;
    note: string;
  };
}

/**
 * `offers_getOfferPerformance` — best-effort performance summary for one offer.
 *
 * The schema doesn't yet track views, conversions, or attributed revenue per
 * offer (no analytics table joins to `offer.id`). This tool returns the raw
 * offer record + linked service + location counts + an explicit
 * `metricsAvailability` envelope that flags the missing data — the model
 * uses this to phrase a "performance data isn't wired up yet" reply instead
 * of inventing numbers.
 *
 * When Phase 4 ships operational snapshots (C-13) or a dedicated offer-views
 * ingest, swap the placeholder fields for real values without changing the
 * tool's wire shape (additive only).
 */
export const getOfferPerformanceTool = defineTool<
  { offerId: string },
  OfferPerformanceOutput
>({
  feature: 'offers',
  action: 'getOfferPerformance',
  description:
    'Show performance summary for a specific offer (id, dates, linked services + locations, pricing, state). ' +
    'Real view/conversion/revenue metrics are not yet ingested for offers — the response includes a `metricsAvailability` flag noting this. Quote the flag rather than fabricating numbers.',
  inputSchema: z.object({
    offerId: z.string().min(1).describe('The ID of the offer to summarise.'),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Loading offer details' },
  execute: async ({ offerId }, ctx) => {
    const data = await ctx.apiFetch(`offers/${offerId}`, {
      schema: offerWithServicesSchema,
    });
    const offer = data.offer;
    const serviceIds = data.serviceIds;
    const locationIds = data.locationIds;

    return {
      data: {
        offerId: offer.id,
        name: offer.name,
        code: offer.code,
        state: offer.state,
        discountType: offer.discountType,
        validFrom: offer.validFrom,
        validUntil: offer.validUntil,
        pricing: {
          originalPriceCents: offer.originalPriceCents,
          offerPriceCents: offer.offerPriceCents,
          discountPercent: offer.discountPercent,
          buyQuantity: offer.buyQuantity,
          getQuantity: offer.getQuantity,
        },
        linkedServiceCount: serviceIds.length,
        serviceIds,
        linkedLocationCount: locationIds.length,
        locationIds,
        metricsAvailability: {
          viewsAvailable: false,
          conversionsAvailable: false,
          revenueAvailable: false,
          note: 'Offer performance metrics (views, conversions, attributed revenue) are not yet ingested. Phase 4 (C-13 operational snapshots) is expected to surface these.',
        },
      },
    };
  },
});
