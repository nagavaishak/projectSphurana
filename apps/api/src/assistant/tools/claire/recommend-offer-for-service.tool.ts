import { db } from '@borradh-workspace/database';
import {
  getBusinessProfile,
  recomputeRanking,
} from '@borradh-workspace/features/claire';
import { listServicesForOrg } from '@borradh-workspace/features/organization-services';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import type { OfferRecommendationOutput } from './types.js';

/**
 * `claire_recommendOfferForService` — given a service id the user committed
 * to, return the offer strategy + recommended intro price + offer copy
 * for that service.
 *
 * Computes the ranking LIVE from the current services (offer strategy +
 * suggested price are pure/deterministic) and reuses cached LLM copy where
 * available — no LLM call on this path. Used by Claire after
 * `set_pending_ad_service` or `set_pending_offer_service` to surface the offer
 * half of the recommendation.
 */
export const recommendOfferForServiceTool = defineTool<
  { serviceId: string },
  OfferRecommendationOutput | { error: string }
>({
  feature: 'claire',
  action: 'recommendOfferForService',
  description:
    'Given a service the user has decided to advertise, return the offer strategy, recommended intro price, and offer copy. Call this AFTER set_pending_ad_service or set_pending_offer_service has set a service.',
  inputSchema: z.object({
    serviceId: z.string().min(1),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Picking the offer shape' },
  execute: async (input, ctx) => {
    const profile = await getBusinessProfile(db, {
      organizationId: ctx.organizationId,
    });
    if (!profile.success) {
      return {
        data: { error: 'No business profile yet — try again in a minute.' },
      };
    }

    const servicesResult = await listServicesForOrg(db, {
      organizationId: ctx.organizationId,
    });
    if (!servicesResult.success) {
      return { data: { error: servicesResult.error.message } };
    }

    const ranked = recomputeRanking(profile.data, servicesResult.data).find(
      (r) => r.serviceId === input.serviceId
    );
    if (!ranked) {
      return {
        data: {
          error:
            'That service is not in the ranked list. Use get_alternative_recommendation if the top pick was rejected, or recommend_service_for_ads to start fresh.',
        },
      };
    }

    return {
      data: {
        serviceId: ranked.serviceId,
        strategy: ranked.offerStrategy,
        suggestedIntroPrice: ranked.suggestedIntroPrice,
        title: ranked.offerRecommendationCopy.title,
        body: ranked.offerRecommendationCopy.body,
      },
    };
  },
});
