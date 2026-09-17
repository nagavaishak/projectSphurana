import { db } from '@borradh-workspace/database';
import {
  getBusinessProfile,
  pickAlternative,
  recomputeRanking,
  trackRecommendationDismissed,
  trackRecommendationImpression,
} from '@borradh-workspace/features/claire';
import { listServicesForOrg } from '@borradh-workspace/features/organization-services';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import type { ServiceRecommendationOutput } from './types.js';

/**
 * `claire_getAlternativeRecommendation` — call when the user rejects
 * the top-pick service. Returns the next-ranked alternative with its
 * reasoning. Does NOT open a fresh push-memory cycle — the existing
 * cycle stays active so push memory still suppresses re-pushes.
 */
export const getAlternativeRecommendationTool = defineTool<
  { rejectedServiceId: string },
  ServiceRecommendationOutput | { error: string }
>({
  feature: 'claire',
  action: 'getAlternativeRecommendation',
  description:
    'Call this when the user rejects the top-pick service. Pass the rejected service id; returns the next-ranked alternative with its reasoning. Do NOT re-push the top pick here.',
  inputSchema: z.object({
    rejectedServiceId: z.string().min(1),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Finding an alternative service' },
  execute: async (input, ctx) => {
    const profile = await getBusinessProfile(db, {
      organizationId: ctx.organizationId,
    });
    if (!profile.success) {
      return { data: { error: 'No business profile yet.' } };
    }

    const servicesResult = await listServicesForOrg(db, {
      organizationId: ctx.organizationId,
    });
    if (!servicesResult.success) {
      return { data: { error: servicesResult.error.message } };
    }
    const services = servicesResult.data;

    const alt = pickAlternative(
      profile.data,
      services,
      input.rejectedServiceId
    );
    if (!alt) {
      return {
        data: {
          error:
            "There's no viable alternative left in the ranked list. Suggest the user add more services, or recommend retargeting instead of cold ads.",
        },
      };
    }

    const service = services.find((s) => s.id === alt.serviceId);
    if (!service) {
      return {
        data: { error: 'Alternative service no longer exists in the menu.' },
      };
    }

    // Live ranking (not the cached snapshot) so the dismissed-event rank/offer
    // metadata matches the same ranking the alternative was drawn from.
    const ranked = recomputeRanking(profile.data, services)
      .slice()
      .sort((a, b) => a.rank - b.rank);

    // The user explicitly rejected the previous pick to land here, so the
    // funnel records both the dismissal of the rejected service and the
    // fresh impression for the new alternative. Rank for the dismissed event
    // is the rank of the rejected service inside the same ranked list.
    const rejected = ranked.find(
      (r) => r.serviceId === input.rejectedServiceId
    );
    if (rejected) {
      trackRecommendationDismissed(ctx.organizationId, {
        surface: 'chat',
        kind: 'ad_flow_service_pick',
        rankedServiceId: rejected.serviceId,
        rank: rejected.rank,
        marketPosition: profile.data.marketPosition,
        offerStrategy: rejected.offerStrategy,
        dismissReason: 'show_alternative',
      });
    }
    trackRecommendationImpression(ctx.organizationId, {
      surface: 'chat',
      kind: 'ad_flow_service_pick',
      rankedServiceId: alt.serviceId,
      rank: alt.rank,
      marketPosition: profile.data.marketPosition,
      offerStrategy: alt.offerStrategy,
    });

    return {
      data: {
        serviceId: alt.serviceId,
        serviceName: service.name,
        rank: alt.rank,
        title: alt.serviceRecommendationCopy.title,
        body: alt.serviceRecommendationCopy.body,
        offer: {
          strategy: alt.offerStrategy,
          suggestedIntroPrice: alt.suggestedIntroPrice,
          title: alt.offerRecommendationCopy.title,
          body: alt.offerRecommendationCopy.body,
        },
        isTopPick: false,
        alreadyPushed: false,
      },
    };
  },
});
